package pkg

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

// SafeDetail 是「什么错误能给用户看」的唯一判定处，走的又是 SSE 这条能把 service
// 错误直送浏览器的通道，所以它错一次就是一次信息泄漏。这里把三类输入都钉住。
func TestSafeDetail(t *testing.T) {
	dbErr := errors.New(`ERROR: duplicate key value violates unique constraint "uniq_root_per_session" (SQLSTATE 23505)`)

	cases := []struct {
		name string
		err  error
		want string
	}{
		{"nil", nil, ""},
		// AppError 的 Message 是我们自己写给用户看的话，原样外发。
		{"AppError 原样给", NotFound("作品不存在，或者它不属于你"), "作品不存在，或者它不属于你"},
		{"业务错误原样给", NewBusinessErrorWithMessage(CodeNoLLMConfig, "没有可用的模型"), "没有可用的模型"},
		// 裸 DB 错误带表名/列名/约束名，一个字都不能外发。
		{"裸 DB 错误换固定文案", dbErr, internalDetail},
		{"包装过的 DB 错误同样拦下", fmt.Errorf("commit: %w", dbErr), internalDetail},
		// 玩家关页面走这条，不是故障。
		{"context.Canceled 不当故障", context.Canceled, "请求已取消"},
		{"包装过的 Canceled 也认", fmt.Errorf("stream: %w", context.Canceled), "请求已取消"},
	}
	for _, c := range cases {
		if got := SafeDetail(c.err); got != c.want {
			t.Errorf("%s：SafeDetail = %q，期望 %q", c.name, got, c.want)
		}
	}

	// 回归守卫：裸错误的**任何**片段都不该出现在外发文案里。
	if strings.Contains(SafeDetail(dbErr), "uniq_root_per_session") ||
		strings.Contains(SafeDetail(dbErr), "23505") {
		t.Error("裸 DB 错误的原文泄漏进了对外文案")
	}
}
