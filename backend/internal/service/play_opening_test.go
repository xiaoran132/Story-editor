package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"backend/internal/model"
	"backend/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

// 开场并发的回归边界。**纯 Go、零数据库**，进默认 `go test -race ./...` 闸门。
//
// 守的是那条唯一能省掉重复生成与重复扣费的机制：进程内单飞。双标签页手测能发现
// 问题，守不住问题——唯一索引只保护落库，拦不住已经花掉的 token 与额度。
//
// 跨实例那一层（部分唯一索引 + 23505 翻幂等）是 Postgres 特性，替身测不出来，
// 见 play_opening_integration_test.go（`-tags=integration`，默认不编译）。

// ---------- 替身 ----------

// fakeSessions 实现 sessionStore。
// ⚠️ FindByID 返回**副本**：真仓储每次查都给一份新结构体，返回同一个指针会让
// leader 对 session 的就地修改被别的 goroutine 看见，-race 直接报，而且掩盖真实语义。
type fakeSessions struct {
	mu       sync.Mutex
	sessions map[uuid.UUID]*model.PlaySession
	// commitErr 非 nil 时 CreateNodeAndUpdateSession 直接返回它（模拟落库撞唯一索引）。
	commitErr error
	commits   int32
}

func newFakeSessions(s *model.PlaySession) *fakeSessions {
	return &fakeSessions{sessions: map[uuid.UUID]*model.PlaySession{s.ID: s}}
}

func (f *fakeSessions) Create(context.Context, *model.PlaySession) error { return nil }

func (f *fakeSessions) FindByID(_ context.Context, id uuid.UUID) (*model.PlaySession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.sessions[id]
	if !ok {
		return nil, nil
	}
	cp := *s
	return &cp, nil
}

func (f *fakeSessions) FindByPlayerID(context.Context, uuid.UUID) ([]model.PlaySession, error) {
	return nil, nil
}

func (f *fakeSessions) Update(_ context.Context, s *model.PlaySession) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := *s
	f.sessions[s.ID] = &cp
	return nil
}

func (f *fakeSessions) CreateNodeAndUpdateSession(_ context.Context, node *model.StoryNode, s *model.PlaySession) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.commitErr != nil {
		return f.commitErr
	}
	atomic.AddInt32(&f.commits, 1)
	if node.ID == uuid.Nil {
		node.ID = uuid.New()
	}
	// 与真仓储同序：Create 回填节点 ID 之后才让会话指向它。
	s.CurrentNodeID = &node.ID
	cp := *s
	f.sessions[s.ID] = &cp
	return nil
}

func (f *fakeSessions) DeleteSessionCascade(context.Context, uuid.UUID) error { return nil }

// setRoot 模拟「别人已经把开场做完了」：直接把会话推进到有根节点的状态。
func (f *fakeSessions) setRoot(id, nodeID uuid.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sessions[id].CurrentNodeID = &nodeID
	f.sessions[id].NodeCount = 1
}

// fakeNodes 实现 nodeStore。
type fakeNodes struct {
	mu    sync.Mutex
	nodes []model.StoryNode
}

func (f *fakeNodes) FindByID(_ context.Context, id uuid.UUID) (*model.StoryNode, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := range f.nodes {
		if f.nodes[i].ID == id {
			cp := f.nodes[i]
			return &cp, nil
		}
	}
	return nil, nil
}

func (f *fakeNodes) FindBySessionID(_ context.Context, sessionID uuid.UUID) ([]model.StoryNode, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []model.StoryNode
	for i := range f.nodes {
		if f.nodes[i].SessionID == sessionID {
			out = append(out, f.nodes[i])
		}
	}
	return out, nil
}

// FindChildren 按 parent_id 过滤，与真仓储一致。**不能返回 nil 了事**：
// 生成前逐字复用与生成后语义去重都建立在这一次查询上，替身敷衍掉它，
// 等于把这两条路径整个挡在测试之外。
func (f *fakeNodes) FindChildren(_ context.Context, parentID uuid.UUID) ([]model.StoryNode, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []model.StoryNode
	for i := range f.nodes {
		if f.nodes[i].ParentID != nil && *f.nodes[i].ParentID == parentID {
			out = append(out, f.nodes[i])
		}
	}
	return out, nil
}

// add 往树上塞一个已存在的节点（测试用）。
func (f *fakeNodes) add(n model.StoryNode) model.StoryNode {
	f.mu.Lock()
	defer f.mu.Unlock()
	if n.ID == uuid.Nil {
		n.ID = uuid.New()
	}
	f.nodes = append(f.nodes, n)
	return n
}
func (f *fakeNodes) FindPath(context.Context, uuid.UUID) ([]model.StoryNode, error) {
	return nil, nil
}

// fakeAI 实现 storyAI。计生成次数，并可阻塞以造出确定的并发窗口。
type fakeAI struct {
	calls   int32
	delay   time.Duration
	gate    chan struct{} // 非 nil 时 StartStoryStream 先等它关闭，用来钉死时序
	entered chan struct{} // 非 nil 时进入 StartStoryStream 立刻 close，让测试确知「已经进来了」
	content string

	contCalls int32 // ContinueStream 被调次数
	// contFn/startFn 非 nil 时决定该次调用的结果（call 从 1 起计），供断流/重试测试注入；
	// 为 nil 时走默认成功路径。
	contFn     func(call int) (*AIResult, error)
	startFn    func(call int, onDelta func(string)) (*AIResult, error)
	mergeCalls int32 // CheckMerge 被调次数
	mergeMu    sync.Mutex
	mergeJudge *AgentLLMConfig                     // 最近一次 CheckMerge 收到的下发配置
	mergeFn    func([]MergeCandidate) (int, error) // 非 nil 时决定判定结果，否则一律 -1
}

func (f *fakeAI) StartStoryStream(
	ctx context.Context, _ WorldConfig, _ map[string]any,
	_ []string, _, _ *AgentLLMConfig, onDelta func(string), _ func(),
) (*AIResult, error) {
	if f.startFn != nil {
		return f.startFn(int(atomic.AddInt32(&f.calls, 1)), onDelta)
	}
	atomic.AddInt32(&f.calls, 1)
	if f.entered != nil {
		close(f.entered)
	}
	if f.gate != nil {
		select {
		case <-f.gate:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if onDelta != nil {
		onDelta(f.content)
	}
	return &AIResult{
		Content:    f.content,
		Options:    []Option{{Text: "走进去"}},
		StateDelta: map[string]any{},
		Summary:    "开场",
	}, nil
}

func (f *fakeAI) ContinueStream(
	_ context.Context, _ WorldConfig, _ []PathStep, _ map[string]any, choice string,
	_ []string, _, _ *AgentLLMConfig, onDelta func(string), _ func(),
) (*AIResult, error) {
	if f.contFn != nil {
		return f.contFn(int(atomic.AddInt32(&f.contCalls, 1)))
	}
	atomic.AddInt32(&f.contCalls, 1)
	if onDelta != nil {
		onDelta(f.content)
	}
	return &AIResult{
		Content:    f.content,
		Options:    []Option{{Text: "继续"}},
		StateDelta: map[string]any{},
		Summary:    "续写：" + choice,
	}, nil
}

func (f *fakeAI) CompleteOpening(
	context.Context, WorldConfig, map[string]any, string, *AgentLLMConfig,
) (*AIResult, error) {
	return nil, errors.New("not used")
}

func (f *fakeAI) CheckMerge(
	_ context.Context, _, _ string, candidates []MergeCandidate, judge *AgentLLMConfig,
) (int, error) {
	atomic.AddInt32(&f.mergeCalls, 1)
	f.mergeMu.Lock()
	f.mergeJudge = judge
	fn := f.mergeFn
	f.mergeMu.Unlock()
	if fn != nil {
		return fn(candidates)
	}
	return -1, nil
}

// lastJudge 取最近一次 CheckMerge 收到的下发配置（判定 agent 有没有拿到凭据）。
func (f *fakeAI) lastJudge() *AgentLLMConfig {
	f.mergeMu.Lock()
	defer f.mergeMu.Unlock()
	return f.mergeJudge
}

// fakeResolver 实现 playLLMResolver：永远解析得到一套平台档配置，审校关闭。
type fakeResolver struct{}

func (fakeResolver) ResolveForPlay(context.Context, uuid.UUID, uuid.UUID, string) (*AgentLLMConfig, error) {
	return &AgentLLMConfig{Provider: "fake", Model: "fake-1", Source: "platform"}, nil
}
func (fakeResolver) ReviewEnabled(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
	return false, nil
}

// fakeCredit 实现 creditCharger：数扣费次数，并记录每次收到的 usage——
// 断流失败路径「烧掉的 token 必须记账」的断言要看具体数字，不只看次数。
type fakeCredit struct {
	calls  int32
	usages []StageUsages
}

func (f *fakeCredit) ChargeAll(_ context.Context, _ uuid.UUID, _ *uuid.UUID, _, _ *AgentLLMConfig, u StageUsages) {
	atomic.AddInt32(&f.calls, 1)
	f.usages = append(f.usages, u)
}

// fakeStories 实现 StoryReader。
type fakeStories struct{ story *model.Story }

func (f fakeStories) FindByID(_ context.Context, id uuid.UUID) (*model.Story, error) {
	if f.story != nil && f.story.ID == id {
		return f.story, nil
	}
	return nil, nil
}

// fakeCounter 实现 StoryCounter：只数阅读量自增次数。
type fakeCounter struct{ calls int32 }

func (f *fakeCounter) IncrPlayCount(context.Context, uuid.UUID) error {
	atomic.AddInt32(&f.calls, 1)
	return nil
}

// ---------- 装配 ----------

type openingFixture struct {
	svc       *PlayService
	sessions  *fakeSessions
	nodes     *fakeNodes
	ai        *fakeAI
	credit    *fakeCredit
	counter   *fakeCounter
	sessionID uuid.UUID
	playerID  uuid.UUID
}

func newOpeningFixture(t *testing.T, ai *fakeAI) *openingFixture {
	t.Helper()
	playerID, storyID := uuid.New(), uuid.New()
	story := &model.Story{
		ID:          storyID,
		CreatorID:   uuid.New(), // 不是玩家本人：脱敏路径也走一遍
		Status:      statusPublished,
		WorldConfig: `{"attributes":{"体力":{"type":"number","initial":10}},"initial_state":{"体力":10}}`,
	}
	session := &model.PlaySession{
		ID:            uuid.New(),
		StoryID:       storyID,
		PlayerID:      playerID,
		CurrentState:  `{"体力":10}`,
		RevealedAttrs: `[]`,
		Status:        "active",
	}
	f := &openingFixture{
		sessions:  newFakeSessions(session),
		nodes:     &fakeNodes{},
		ai:        ai,
		credit:    &fakeCredit{},
		counter:   &fakeCounter{},
		sessionID: session.ID,
		playerID:  playerID,
	}
	f.svc = NewPlayService(f.sessions, f.nodes, fakeStories{story}, ai, fakeResolver{}, f.credit, f.counter)
	return f
}

// ---------- ① 单飞互斥：唯一能省掉重复生成与重复扣费的一层 ----------

func TestStartOpeningStream_ConcurrentGeneratesOnce(t *testing.T) {
	const callers = 8
	f := newOpeningFixture(t, &fakeAI{delay: 60 * time.Millisecond, content: "夜里电台还开着"})

	type outcome struct {
		res *SessionResult
		err error
		// 每个调用方各自收自己的 delta，互不共享——共享一个 buffer 会把
		// 「follower 有没有拿到回放」这条断言变成竞态。
		text string
	}
	results := make([]outcome, callers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range callers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			var sb []byte
			<-start // 尽量对齐发车时刻，把窗口做窄
			res, err := f.svc.StartOpeningStream(
				context.Background(), f.sessionID, f.playerID,
				func(d string) { sb = append(sb, d...) }, func() {},
			)
			results[i] = outcome{res: res, err: err, text: string(sb)}
		}(i)
	}
	close(start)
	wg.Wait()

	if got := atomic.LoadInt32(&f.ai.calls); got != 1 {
		t.Fatalf("AI 生成被调用 %d 次，应当只有 1 次——单飞没生效，重复的 token 已经花掉了", got)
	}
	if got := atomic.LoadInt32(&f.credit.calls); got != 1 {
		t.Errorf("ChargeAll 被调用 %d 次，应当只有 1 次——重复扣费", got)
	}
	if got := atomic.LoadInt32(&f.counter.calls); got != 1 {
		t.Errorf("play_count 自增 %d 次，应当只有 1 次", got)
	}
	if got := atomic.LoadInt32(&f.sessions.commits); got != 1 {
		t.Errorf("落库事务提交 %d 次，应当只有 1 次", got)
	}

	// 后到者是**复用而非报错**，且拿到的是同一份开场。
	var nodeID string
	for i, o := range results {
		if o.err != nil {
			t.Fatalf("第 %d 个调用方拿到错误：%v（后到者应当复用 leader 的结果）", i, o.err)
		}
		if o.res == nil || o.res.CurrentNode == nil {
			t.Fatalf("第 %d 个调用方没拿到根节点", i)
		}
		if i == 0 {
			nodeID = o.res.CurrentNode.ID.String()
		} else if o.res.CurrentNode.ID.String() != nodeID {
			t.Errorf("第 %d 个调用方拿到的是另一个根节点：%s ≠ %s", i, o.res.CurrentNode.ID, nodeID)
		}
		// follower 不接自己的 onDelta 进共享工作，靠 streamFixedText 回放；
		// 少了这一步它会盯着空白等到最后那帧 done。
		if o.text != "夜里电台还开着" {
			t.Errorf("第 %d 个调用方收到的正文流是 %q，应当是完整开场（follower 回放缺失）", i, o.text)
		}
	}
}

// leader 抢到身份后必须**重读会话**：调用方那次预检发生在 LoadOrStore 之前，
// 中间的调度间隙足够上一个 leader 生成完、提交、Delete。不重读就会又生成一次、
// 又扣一次费，直到最后才被唯一索引拦下——而索引拦不住已经花掉的 token。
func TestStartOpeningStream_LeaderRereadsSessionBeforeGenerating(t *testing.T) {
	f := newOpeningFixture(t, &fakeAI{content: "不该被生成"})

	// 先把库推进到「开场已经做完」的状态，再发起请求。
	root := model.StoryNode{
		ID: uuid.New(), SessionID: f.sessionID, ParentID: nil, Depth: 0,
		Content: "别人已经写好的开场", StateDelta: "{}", StateSnapshot: `{"体力":10}`,
		RevealedSnapshot: `[]`, SuggestedOptions: `[]`,
	}
	f.nodes.nodes = append(f.nodes.nodes, root)
	f.sessions.setRoot(f.sessionID, root.ID)

	res, err := f.svc.StartOpeningStream(context.Background(), f.sessionID, f.playerID, func(string) {}, func() {})
	if err != nil {
		t.Fatalf("应当幂等返回既有开场，却报错：%v", err)
	}
	if res.CurrentNode == nil || res.CurrentNode.ID != root.ID {
		t.Fatalf("返回的不是既有根节点")
	}
	if got := atomic.LoadInt32(&f.ai.calls); got != 0 {
		t.Errorf("AI 被调用 %d 次，应当一次都不发起", got)
	}
	if got := atomic.LoadInt32(&f.credit.calls); got != 0 {
		t.Errorf("扣费 %d 次，应当一次都不扣", got)
	}
}

// 落库撞上 uniq_root_per_session 要翻成**幂等成功**，不是 500：
// 玩家看到的应该是开场，不是一句「内部错误」。
func TestStartOpeningStream_RootConflictAdoptsExisting(t *testing.T) {
	f := newOpeningFixture(t, &fakeAI{content: "本实例生成的开场"})

	// 别的实例已经插了根节点，本实例的事务会撞唯一索引。
	root := model.StoryNode{
		ID: uuid.New(), SessionID: f.sessionID, ParentID: nil, Depth: 0,
		Content: "别的实例写的开场", StateDelta: "{}", StateSnapshot: `{"体力":10}`,
		RevealedSnapshot: `[]`, SuggestedOptions: `[]`,
	}
	f.nodes.nodes = append(f.nodes.nodes, root)
	f.sessions.commitErr = &pgconn.PgError{
		Code: "23505", ConstraintName: repository.RootIdxName,
		Message: "duplicate key value violates unique constraint",
	}

	res, err := f.svc.StartOpeningStream(context.Background(), f.sessionID, f.playerID, func(string) {}, func() {})
	if err != nil {
		t.Fatalf("唯一冲突应当翻成幂等成功，却上抛了：%v", err)
	}
	if res.CurrentNode == nil || res.CurrentNode.ID != root.ID {
		t.Fatalf("应当返回既有的那个根节点")
	}
	if got := atomic.LoadInt32(&f.counter.calls); got != 0 {
		t.Errorf("撞冲突的这次不该给 play_count 计数（那一次已由插入成功的一方计过），实际 %d", got)
	}
}

// ⚠️ 只匹配 23505 会把将来任何一条唯一约束冲突都吞成「根节点已存在」，
// 把真实错误埋掉。约束名必须一起判。
func TestIsRootConflict_RequiresConstraintName(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"根节点索引冲突", &pgconn.PgError{Code: "23505", ConstraintName: repository.RootIdxName}, true},
		{"别的唯一约束冲突", &pgconn.PgError{Code: "23505", ConstraintName: "uniq_story_like"}, false},
		{"非唯一冲突", &pgconn.PgError{Code: "23503", ConstraintName: repository.RootIdxName}, false},
		{"包装后的根节点冲突", fmt.Errorf("commit: %w",
			&pgconn.PgError{Code: "23505", ConstraintName: repository.RootIdxName}), true},
		{"只有错误码的文本", errors.New("SQLSTATE 23505"), false},
		{"文本里两条都在", errors.New("23505 duplicate key value violates unique constraint \"" + repository.RootIdxName + "\""), true},
	}
	for _, c := range cases {
		if got := isRootConflict(c.err); got != c.want {
			t.Errorf("%s：isRootConflict = %v，期望 %v", c.name, got, c.want)
		}
	}
}

// ---------- ④ leader 的失败必须传达给 follower ----------

// fakeStoriesErr 把 leader 钉在 stories.FindByID 上（gate 关闭前一直阻塞），
// 好让 follower 有机会加入同一个 flight；放行后返回一个存储故障。
//
// ⚠️ 不给现有 fakeStories 加字段：newOpeningFixture 用位置字面量 fakeStories{story}
// 构造它，多一个字段就编译不过。
type fakeStoriesErr struct {
	gate chan struct{}
	err  error
}

func (f *fakeStoriesErr) FindByID(context.Context, uuid.UUID) (*model.Story, error) {
	<-f.gate
	return nil, f.err
}

// leader 中途失败时，**每一条 return 都必须把原因填进 flight**——follower 只看 fl.err
// 判断成败。漏填一处，follower 就会把「失败」当成「成功」，转身去读 fl.root.Content，
// 而那是个 nil。这条用例守的就是这个：follower 必须拿到 error，而不是 panic。
func TestStartOpeningStream_LeaderErrorReachesFollower(t *testing.T) {
	playerID, storyID := uuid.New(), uuid.New()
	session := &model.PlaySession{
		ID: uuid.New(), StoryID: storyID, PlayerID: playerID,
		CurrentState: `{}`, RevealedAttrs: `[]`, Status: "active",
	}
	sessions := newFakeSessions(session)
	stories := &fakeStoriesErr{gate: make(chan struct{}), err: errors.New("db is down")}
	svc := NewPlayService(sessions, &fakeNodes{}, stories, &fakeAI{},
		fakeResolver{}, &fakeCredit{}, &fakeCounter{})

	// leader 先进去，卡在 stories.FindByID 上。
	leaderErr := make(chan error, 1)
	joined := make(chan struct{})
	go func() {
		close(joined)
		_, err := svc.StartOpeningStream(context.Background(), session.ID, playerID, nil, nil)
		leaderErr <- err
	}()
	<-joined

	// follower 随后加入同一个 flight（等 leader 抢到注册表里的位置）。
	followerErr := make(chan error, 1)
	followerPanic := make(chan any, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				followerPanic <- r
			}
		}()
		for { // 等 leader 建好 flight，再让 follower 进去当 follower
			if _, ok := svc.flights.Load(session.ID); ok {
				break
			}
			time.Sleep(time.Millisecond)
		}
		_, err := svc.StartOpeningStream(context.Background(), session.ID, playerID, func(string) {}, nil)
		followerErr <- err
	}()

	// 两边都就位后放行，让 leader 拿到存储故障。
	time.Sleep(30 * time.Millisecond)
	close(stories.gate)

	if err := <-leaderErr; err == nil {
		t.Fatal("leader 应当上抛存储故障")
	}
	select {
	case r := <-followerPanic:
		t.Fatalf("follower 不该 panic（leader 的失败没有填进 flight）：%v", r)
	case err := <-followerErr:
		if err == nil {
			t.Fatal("leader 失败了，follower 不该拿到成功")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("follower 既没返回也没 panic —— 它被永久挂起了")
	}
}
