package service

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"

	"backend/internal/model"

	"github.com/google/uuid"
)

// 分支复用的回归边界。**纯 Go、零数据库**，进默认 `go test -race ./...` 闸门。
//
// 守两件曾经同时失效的事：
//   ① 逐字相同的选择必须在**生成之前**被截住——回溯重选走既有分支，一个 token 都不该烧。
//   ② CheckMerge 必须拿到模型连接。漏掉它时 agent 每次 502，而错误被当成「不合并」
//      吞掉，于是节点合并全线静默死亡，外部只表现为「合并没生效」。

// choiceFixture 把会话推进到「已有开场根节点」的状态，供续写测试直接用。
func choiceFixture(t *testing.T, ai *fakeAI) (*openingFixture, model.StoryNode) {
	t.Helper()
	f := newOpeningFixture(t, ai)
	root := f.nodes.add(model.StoryNode{
		SessionID:        f.sessionID,
		ParentID:         nil,
		Depth:            0,
		Content:          "夜里电台还开着",
		StateDelta:       `{}`,
		StateSnapshot:    `{"体力":10}`,
		RevealedSnapshot: `[]`,
	})
	f.sessions.setRoot(f.sessionID, root.ID)
	return f, root
}

// addChild 在 root 下挂一个已经生成过的分支。
func addChild(f *openingFixture, root model.StoryNode, choice string) model.StoryNode {
	ct := choice
	return f.nodes.add(model.StoryNode{
		SessionID:        f.sessionID,
		ParentID:         &root.ID,
		Depth:            1,
		ChoiceText:       &ct,
		Content:          "你推开了那扇门",
		Summary:          "进门",
		StateDelta:       `{}`,
		StateSnapshot:    `{"体力":9}`,
		RevealedSnapshot: `[]`,
	})
}

// ① 逐字相同的选择：直接走既有分支，不生成、不扣费、不建节点。
func TestMakeChoiceStream_ReusesIdenticalChoice(t *testing.T) {
	ai := &fakeAI{content: "不该被生成"}
	f, root := choiceFixture(t, ai)
	child := addChild(f, root, "走进去")

	var streamed strings.Builder
	res, err := f.svc.MakeChoiceStream(
		context.Background(), f.sessionID, f.playerID, "走进去",
		func(s string) { streamed.WriteString(s) }, func() {},
	)
	if err != nil {
		t.Fatalf("复用既有分支不该报错: %v", err)
	}

	if n := atomic.LoadInt32(&ai.contCalls); n != 0 {
		t.Errorf("既有分支不该触发生成，ContinueStream 被调了 %d 次", n)
	}
	if n := atomic.LoadInt32(&f.credit.calls); n != 0 {
		t.Errorf("没有生成就不该扣费，ChargeAll 被调了 %d 次", n)
	}
	if n := atomic.LoadInt32(&f.sessions.commits); n != 0 {
		t.Errorf("复用不该新建节点，CreateNodeAndUpdateSession 被调了 %d 次", n)
	}
	if streamed.Len() != 0 {
		t.Errorf("复用没有生成过程，不该有 delta，却收到 %q", streamed.String())
	}
	if res.CurrentNode == nil || res.CurrentNode.ID != child.ID {
		t.Fatalf("会话应指向既有子节点 %s，实际 %+v", child.ID, res.CurrentNode)
	}

	// 会话指针真的落库了（不只是返回值好看）。
	sess, _ := f.sessions.FindByID(context.Background(), f.sessionID)
	if sess.CurrentNodeID == nil || *sess.CurrentNodeID != child.ID {
		t.Errorf("落库的 current_node_id 应为 %s，实际 %v", child.ID, sess.CurrentNodeID)
	}
	if sess.CurrentState != child.StateSnapshot {
		t.Errorf("current_state 应同步为复用节点的快照 %s，实际 %s", child.StateSnapshot, sess.CurrentState)
	}
}

// 前后空白不算不同的选择——否则前端多一个空格就白烧一次生成。
func TestMakeChoiceStream_ReuseTrimsWhitespace(t *testing.T) {
	ai := &fakeAI{content: "不该被生成"}
	f, root := choiceFixture(t, ai)
	child := addChild(f, root, "  走进去  ")

	res, err := f.svc.MakeChoiceStream(
		context.Background(), f.sessionID, f.playerID, "走进去", func(string) {}, func() {},
	)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if atomic.LoadInt32(&ai.contCalls) != 0 || res.CurrentNode.ID != child.ID {
		t.Errorf("仅差前后空白应判为同一选择，却走了新生成")
	}
}

// ② 不同的选择照常生成，且 CheckMerge 必须拿到模型连接（原 bug 的回归闸）。
func TestMakeChoiceStream_NewChoiceGeneratesAndPassesJudgeConfig(t *testing.T) {
	ai := &fakeAI{content: "你转身走向后门"}
	f, root := choiceFixture(t, ai)
	addChild(f, root, "走进去")

	res, err := f.svc.MakeChoiceStream(
		context.Background(), f.sessionID, f.playerID, "从后门绕过去", func(string) {}, func() {},
	)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}

	if n := atomic.LoadInt32(&ai.contCalls); n != 1 {
		t.Errorf("新选择应生成恰好一次，实际 %d 次", n)
	}
	if n := atomic.LoadInt32(&f.credit.calls); n != 1 {
		t.Errorf("生成一次应扣费一次，实际 %d 次", n)
	}
	if n := atomic.LoadInt32(&f.sessions.commits); n != 1 {
		t.Errorf("应新建一个节点，实际提交 %d 次", n)
	}
	if res.CurrentNode == nil || res.CurrentNode.ID == uuid.Nil {
		t.Fatalf("应返回新建的节点，实际 %+v", res.CurrentNode)
	}

	// 候选的 state_delta 与本次生成同为 {}，硬过滤放行 → 必然调到 CheckMerge。
	if n := atomic.LoadInt32(&ai.mergeCalls); n != 1 {
		t.Fatalf("同层有 delta 相等的候选，应调一次 CheckMerge，实际 %d 次", n)
	}
	if ai.lastJudge() == nil {
		t.Error("CheckMerge 收到的模型连接为 nil —— agent 不持有默认凭据，这会让 /merge-check 每次 502")
	}
}

// ③ 语义去重命中：复用既有节点，不新建。
func TestMakeChoiceStream_SemanticMergeAdoptsExistingNode(t *testing.T) {
	ai := &fakeAI{content: "你推开了那扇门"}
	ai.mergeFn = func([]MergeCandidate) (int, error) { return 0, nil } // agent 判定等价
	f, root := choiceFixture(t, ai)
	child := addChild(f, root, "走进去")

	res, err := f.svc.MakeChoiceStream(
		context.Background(), f.sessionID, f.playerID, "走到门里面去", func(string) {}, func() {},
	)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if n := atomic.LoadInt32(&ai.contCalls); n != 1 {
		t.Errorf("近义选择判不出来之前必须先生成，实际生成 %d 次", n)
	}
	if n := atomic.LoadInt32(&f.sessions.commits); n != 0 {
		t.Errorf("语义命中应复用既有节点而非新建，实际提交 %d 次", n)
	}
	if res.CurrentNode == nil || res.CurrentNode.ID != child.ID {
		t.Errorf("应复用 %s，实际 %+v", child.ID, res.CurrentNode)
	}
}

// ④ 判定失败不许拦住玩家：照常建新节点（错误只进日志）。
func TestMakeChoiceStream_MergeCheckFailureStillAdvances(t *testing.T) {
	ai := &fakeAI{content: "你推开了那扇门"}
	ai.mergeFn = func([]MergeCandidate) (int, error) { return -1, context.DeadlineExceeded }
	f, root := choiceFixture(t, ai)
	addChild(f, root, "走进去")

	res, err := f.svc.MakeChoiceStream(
		context.Background(), f.sessionID, f.playerID, "走到门里面去", func(string) {}, func() {},
	)
	if err != nil {
		t.Fatalf("去重判定失败不该让这一回合失败: %v", err)
	}
	if n := atomic.LoadInt32(&f.sessions.commits); n != 1 {
		t.Errorf("判定失败应回退到新建节点，实际提交 %d 次", n)
	}
	if res.CurrentNode == nil {
		t.Error("应返回新建的节点")
	}
}
