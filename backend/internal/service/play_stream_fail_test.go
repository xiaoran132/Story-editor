package service

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
)

// P0-1 断流契约的回归锁（docs/optimization-plan.md）：
//   ① agent error 帧带出的 usage 必须在失败路径记账——烧掉的 token 不能只让成功回合买单；
//   ② 首帧前失败整请求安全重试一次（agent 无状态、history 全量重发天然幂等）；
//   ③ 已有增量外发后不得重试（会向玩家重复半截正文），失败照常报错、不落库。

// ①+② error 帧带 burned usage，且首帧前失败重试一次成功。
func TestMakeChoiceStream_BurnedUsageBilledAndRetryBeforeFirstDelta(t *testing.T) {
	ai := &fakeAI{content: "重试后的稿子"}
	ai.contFn = func(call int) (*AIResult, error) {
		if call == 1 {
			return nil, &StreamError{
				Err:   fmt.Errorf("ai stream error: LLMParseError: bad json"),
				Usage: StageUsages{Write: TokenUsage{PromptTokens: 30, CompletionTokens: 12}},
			}
		}
		return &AIResult{
			Content: "重试后的稿子", Options: []Option{{Text: "继续"}},
			StateDelta: map[string]any{}, Summary: "s",
		}, nil
	}
	f, _ := choiceFixture(t, ai)

	res, err := f.svc.MakeChoiceStream(
		context.Background(), f.sessionID, f.playerID, "新选择", func(string) {}, func() {},
	)
	if err != nil {
		t.Fatalf("首帧前失败应重试成功: %v", err)
	}
	if n := atomic.LoadInt32(&ai.contCalls); n != 2 {
		t.Errorf("首帧前失败应恰好重试一次，实际生成 %d 次", n)
	}
	if n := atomic.LoadInt32(&f.credit.calls); n != 2 {
		t.Errorf("失败一次（burned）+成功一次都应记账，实际 ChargeAll %d 次", n)
	}
	if len(f.credit.usages) < 2 || f.credit.usages[0].Write.PromptTokens != 30 {
		t.Errorf("第一笔应记 error 帧带来的 burned usage (30/12)，实际 %+v", f.credit.usages)
	}
	if res.CurrentNode == nil {
		t.Error("重试成功后应正常落节点")
	}
}

// ③ 已出 delta 后断流：不重试、失败路径记账 burned usage、玩家收到错误、不落库。
func TestMakeChoiceStream_NoRetryAfterDeltaStreamed(t *testing.T) {
	ai := &fakeAI{}
	ai.contFn = func(int) (*AIResult, error) {
		return nil, &StreamError{
			Err:      fmt.Errorf("read stream: connection reset"),
			Usage:    StageUsages{Write: TokenUsage{PromptTokens: 10, CompletionTokens: 5}},
			SawDelta: true, // 半截正文已经发给玩家了
		}
	}
	f, _ := choiceFixture(t, ai)

	_, err := f.svc.MakeChoiceStream(
		context.Background(), f.sessionID, f.playerID, "新选择", func(string) {}, func() {},
	)
	if err == nil {
		t.Fatal("断流后玩家回合应收到错误而非静默成功")
	}
	if !strings.Contains(err.Error(), aiUnavailableMsg) {
		t.Errorf("应以内置文案报错，实际 %v", err)
	}
	if n := atomic.LoadInt32(&ai.contCalls); n != 1 {
		t.Errorf("已出增量不得重试（会重复半截正文），实际生成 %d 次", n)
	}
	if n := atomic.LoadInt32(&f.credit.calls); n != 1 {
		t.Errorf("失败路径也要记一笔 burned usage，实际 ChargeAll %d 次", n)
	}
	if len(f.credit.usages) != 1 || f.credit.usages[0].Write.PromptTokens != 10 {
		t.Errorf("应记下 error 帧的 burned usage (10/5)，实际 %+v", f.credit.usages)
	}
	if n := atomic.LoadInt32(&f.sessions.commits); n != 0 {
		t.Errorf("失败回合不该落节点，实际提交 %d 次", n)
	}
}

// 开场链路同样受断流契约保护：首帧前失败重试一次；第一笔零值 usage 记账调不动钱。
func TestStartOpeningStream_StreamErrorRetriesBeforeFirstDelta(t *testing.T) {
	ai := &fakeAI{content: "夜里电台还开着"}
	ai.startFn = func(call int, onDelta func(string)) (*AIResult, error) {
		if call == 1 {
			return nil, &StreamError{Err: fmt.Errorf("call ai stream: connection refused")}
		}
		if onDelta != nil {
			onDelta("夜里电台还开着")
		}
		return &AIResult{
			Content: "夜里电台还开着", Options: []Option{{Text: "走进去"}},
			StateDelta: map[string]any{}, Summary: "开场",
		}, nil
	}
	f := newOpeningFixture(t, ai)

	res, err := f.svc.StartOpeningStream(
		context.Background(), f.sessionID, f.playerID, func(string) {}, func() {},
	)
	if err != nil {
		t.Fatalf("首帧前失败应重试成功: %v", err)
	}
	if n := atomic.LoadInt32(&ai.calls); n != 2 {
		t.Errorf("应重试一次，实际生成 %d 次", n)
	}
	if n := atomic.LoadInt32(&f.credit.calls); n != 2 {
		t.Errorf("失败（零值 usage，扣不动钱）+成功各记一次，实际 ChargeAll %d 次", n)
	}
	if res.CurrentNode == nil {
		t.Error("重试成功后应建根节点")
	}
}

// 连续两次首帧前失败：重试只有一次，且**两次**已烧 usage 都要记账。
func TestMakeChoiceStream_DoubleFailureBillsBothAttempts(t *testing.T) {
	ai := &fakeAI{}
	usages := []StageUsages{
		{Write: TokenUsage{PromptTokens: 30, CompletionTokens: 10}},
		{Write: TokenUsage{PromptTokens: 50, CompletionTokens: 20}},
	}
	ai.contFn = func(call int) (*AIResult, error) {
		return nil, &StreamError{
			Err:   fmt.Errorf("ai stream error: LLMParseError: bad json (#%d)", call),
			Usage: usages[call-1],
		}
	}
	f, _ := choiceFixture(t, ai)

	_, err := f.svc.MakeChoiceStream(
		context.Background(), f.sessionID, f.playerID, "新选择", func(string) {}, func() {},
	)
	if err == nil {
		t.Fatal("两次失败应向玩家报错")
	}
	if n := atomic.LoadInt32(&ai.contCalls); n != 2 {
		t.Errorf("重试应恰好一次（共两次调用），实际 %d 次", n)
	}
	if len(f.credit.usages) != 2 {
		t.Fatalf("两次失败的已烧 usage 都要记账，实际 %d 笔: %+v", len(f.credit.usages), f.credit.usages)
	}
	if f.credit.usages[0].Write.PromptTokens != 30 || f.credit.usages[1].Write.PromptTokens != 50 {
		t.Errorf("两笔 burned usage 数值不对: %+v", f.credit.usages)
	}
}
