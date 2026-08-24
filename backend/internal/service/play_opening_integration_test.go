//go:build integration

package service

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"
	"testing"

	"backend/internal/model"
	"backend/internal/repository"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 跨实例那一层的回归：部分唯一索引 `uniq_root_per_session` + 23505 翻成幂等成功。
//
// 这是 Postgres 特性，替身测不出来，所以带 `//go:build integration` 标签，**默认不编译**。
// 现有闸门 `go test -race ./...` 不需要 PostgreSQL 就能跑，这一条不能被打破——一刀切加
// PG 集成测试，会让没装 PG 的人连 `go test ./...` 都过不了。
//
// 跑法（⚠️ go.mod 在 backend/，必须在 backend/ 里跑）：
//
//	Push-Location backend
//	$env:TEST_DB_DSN = "<可随意清空的隔离测试库 DSN>"
//	go test -tags=integration ./internal/service/ -run Opening -v
//	Pop-Location
//
// ⚠️ **只能指向可随意清空的隔离测试库。** 这组测试会建/删索引、制造唯一冲突、改
// play_count。每个用例自建自清（t.Cleanup），不依赖库里预先存在的数据。

var testDB *gorm.DB

// TestMain 只负责建连和 m.Run()。
// ⚠️ TestMain(m *testing.M) 拿不到 *testing.T，不能调 t.Skip；也**不能**在缺 DSN 时
// os.Exit(0)——那样 `-tags=integration` 会把同包里那些纯 Go 测试一起跳过。
// 所以：连不上就把 testDB 留成 nil，由每个集成用例自己 skip。
func TestMain(m *testing.M) {
	if dsn := os.Getenv("TEST_DB_DSN"); dsn != "" {
		db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Silent),
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "TEST_DB_DSN 连接失败，集成用例将跳过：%v\n", err)
		} else {
			testDB = db
		}
	} else {
		fmt.Fprintln(os.Stderr, "未设置 TEST_DB_DSN，集成用例将跳过（纯 Go 用例照常运行）")
	}
	os.Exit(m.Run())
}

// requireDB 建 schema 并返回连接。
// ⚠️ **测试必须自己把 schema 建起来**：一个全新的隔离库是空的，而 go test 不会执行
// main.go。不写 setup 的话，测试实际上隐式依赖「这个库以前被服务跑过」，与「隔离、
// 自建、自清」自相矛盾。
func requireDB(t *testing.T) *gorm.DB {
	t.Helper()
	if testDB == nil {
		t.Skip("需要 TEST_DB_DSN 指向隔离测试库")
	}
	// gen_random_uuid() 依赖 pgcrypto，与 main.go 同一条。
	if err := testDB.Exec("CREATE EXTENSION IF NOT EXISTS pgcrypto").Error; err != nil {
		t.Fatalf("create extension pgcrypto: %v", err)
	}
	if err := testDB.AutoMigrate(
		&model.User{}, &model.Story{}, &model.PlaySession{}, &model.StoryNode{},
	); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	// ⚠️ EnsureRootIndex 在这里是**被测对象之一，不是前置条件**：正常库上它必须返回 nil。
	if err := repository.NewNodeRepository(testDB).EnsureRootIndex(context.Background()); err != nil {
		t.Fatalf("EnsureRootIndex 在干净库上应当成功：%v", err)
	}
	return testDB
}

// seedStoryAndSession 造一部已发布作品 + 一局空会话，用完删干净。
func seedStoryAndSession(t *testing.T, db *gorm.DB) (*model.Story, *model.PlaySession) {
	t.Helper()
	story := &model.Story{
		ID:          uuid.New(),
		CreatorID:   uuid.New(),
		Title:       "集成测试作品",
		Status:      statusPublished,
		WorldConfig: `{"attributes":{"体力":{"type":"number","initial":10}},"initial_state":{"体力":10}}`,
	}
	if err := db.Create(story).Error; err != nil {
		t.Fatalf("create story: %v", err)
	}
	session := &model.PlaySession{
		ID:            uuid.New(),
		StoryID:       story.ID,
		PlayerID:      uuid.New(),
		CurrentState:  `{"体力":10}`,
		RevealedAttrs: `[]`,
		Status:        "active",
	}
	if err := db.Create(session).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}
	t.Cleanup(func() {
		db.Where("session_id = ?", session.ID).Delete(&model.StoryNode{})
		db.Delete(&model.PlaySession{}, "id = ?", session.ID)
		db.Delete(&model.Story{}, "id = ?", story.ID)
	})
	return story, session
}

func newDBPlayService(db *gorm.DB, ai *fakeAI, credit *fakeCredit) *PlayService {
	storyRepo := repository.NewStoryRepository(db)
	// ⚠️ 同一个 storyRepo 传两次是刻意的：它同时满足 StoryReader（只读）与
	// StoryCounter（计数回写）两个窄接口，而两个接口表达两种能力。
	return NewPlayService(
		repository.NewPlaySessionRepository(db),
		repository.NewNodeRepository(db),
		storyRepo, ai, fakeResolver{}, credit, storyRepo,
	)
}

// ② 跨实例：唯一索引拒绝第二个根节点，且 23505 被翻成幂等成功。
//
// ⚠️ **单飞会让这条在单进程内不可达**，必须显式模拟跨实例：两个独立的 PlayService，
// 各持有自己的 flights sync.Map，共用同一个 *gorm.DB。
//
// ⚠️ 而且「并发调用」本身不保证走到冲突分支：A 若先提交完，B 的 leader 重读就会看见
// CurrentNodeID 已被写入，转去走普通幂等分支，23505 的翻译路径一次都没执行——测试
// 绿了却什么都没测到。所以窗口必须**用 B 的假 AI 卡出来**，不依赖调度运气。
func TestOpeningRootConflictAcrossInstances(t *testing.T) {
	db := requireDB(t)
	story, session := seedStoryAndSession(t, db)

	aiA := &fakeAI{content: "A 实例写的开场"}
	aiB := &fakeAI{
		content: "B 实例写的开场",
		entered: make(chan struct{}),
		gate:    make(chan struct{}),
	}
	creditA, creditB := &fakeCredit{}, &fakeCredit{}
	svcA := newDBPlayService(db, aiA, creditA)
	svcB := newDBPlayService(db, aiB, creditB)

	type res struct {
		out *SessionResult
		err error
	}
	bDone := make(chan res, 1)
	go func() {
		out, err := svcB.StartOpeningStream(
			context.Background(), session.ID, session.PlayerID, func(string) {}, func() {})
		bDone <- res{out, err}
	}()

	<-aiB.entered // B 已过归属校验、过 leader 重读（此时库里还是 nil），卡在生成里
	outA, errA := svcA.StartOpeningStream(
		context.Background(), session.ID, session.PlayerID, func(string) {}, func() {})
	if errA != nil {
		t.Fatalf("A 应当正常生成开场：%v", errA)
	}
	close(aiB.gate) // 放开 B：它带着自己那份根节点去插入，必然撞唯一索引
	b := <-bDone

	if b.err != nil {
		t.Fatalf("B 撞上唯一索引应当翻成**幂等成功**而不是 500：%v", b.err)
	}
	if b.out.CurrentNode == nil || outA.CurrentNode == nil {
		t.Fatalf("两边都应当拿到根节点")
	}
	if b.out.CurrentNode.ID != outA.CurrentNode.ID {
		t.Errorf("B 应当接受 A 那个根节点，实际 B=%s A=%s", b.out.CurrentNode.ID, outA.CurrentNode.ID)
	}
	if b.out.CurrentNode.Content != "A 实例写的开场" {
		t.Errorf("B 返回的正文应当是 A 写的那份，实际 %q", b.out.CurrentNode.Content)
	}

	// 库里只有一个根节点——这才是唯一索引真正保证的东西。
	var roots int64
	db.Model(&model.StoryNode{}).
		Where("session_id = ? AND parent_id IS NULL", session.ID).Count(&roots)
	if roots != 1 {
		t.Errorf("根节点 %d 个，应当只有 1 个", roots)
	}

	// 阅读量只 +1：撞冲突的那一方不计数（那一次已由插入成功的一方计过）。
	var fresh model.Story
	db.First(&fresh, "id = ?", story.ID)
	if fresh.PlayCount != 1 {
		t.Errorf("play_count = %d，应当只 +1", fresh.PlayCount)
	}

	// ⚠️ 这一层**挡不住 B 已经花掉的生成与扣费**——那是单飞（①）的职责，而单飞只在
	// 单实例内有效。这里把它断言出来，是为了让「② 只保证数据是对的」这句话有据可查：
	// 谁哪天以为唯一索引能省钱，这行会告诉他不能。
	if got := atomic.LoadInt32(&creditB.calls); got != 1 {
		t.Errorf("B 的扣费次数 = %d，预期 1（跨实例重复扣费是已知代价，不是 bug）", got)
	}
}

// EnsureRootIndex 在有重复根节点的脏库上必须返回错误——main.go 正是据此 log.Fatalf：
// 库脏了就别让服务带病起来。
//
// ⚠️ 这条断言在 setup 已建好索引的库上根本走不到：索引在，第二个 root 插不进去；
// 而 CREATE UNIQUE INDEX IF NOT EXISTS 遇到已存在会直接跳过、不报错。所以该用例
// 必须自己管理索引的生命周期。
// ⚠️ 它改的是**全局 schema**，因此不能 t.Parallel()，恢复动作必须在 t.Cleanup 里——
// 中途失败也不能把索引留在缺失状态，否则后面所有用例的前提都没了。
func TestEnsureRootIndexRejectsDirtyData(t *testing.T) {
	db := requireDB(t)
	_, session := seedStoryAndSession(t, db)
	nodeRepo := repository.NewNodeRepository(db)
	ctx := context.Background()

	t.Cleanup(func() {
		db.Where("session_id = ?", session.ID).Delete(&model.StoryNode{})
		if err := nodeRepo.EnsureRootIndex(ctx); err != nil {
			t.Errorf("清理阶段重建索引失败，库被留在缺索引状态：%v", err)
		}
	})

	if err := db.Exec("DROP INDEX IF EXISTS " + repository.RootIdxName).Error; err != nil {
		t.Fatalf("drop index: %v", err)
	}
	for i := range 2 {
		n := &model.StoryNode{
			ID: uuid.New(), SessionID: session.ID, StoryID: session.StoryID,
			ParentID: nil, Depth: 0, Content: fmt.Sprintf("重复根节点 %d", i),
			SuggestedOptions: `[]`, StateDelta: `{}`, StateSnapshot: `{}`, RevealedSnapshot: `[]`,
		}
		if err := db.Create(n).Error; err != nil {
			t.Fatalf("插入第 %d 个根节点失败（索引应当已被 DROP）：%v", i, err)
		}
	}

	if err := nodeRepo.EnsureRootIndex(ctx); err == nil {
		t.Fatal("库里有重复根节点时 EnsureRootIndex 必须报错，否则 main.go 会带病启动")
	}

	db.Where("session_id = ?", session.ID).Delete(&model.StoryNode{})
	if err := nodeRepo.EnsureRootIndex(ctx); err != nil {
		t.Fatalf("清干净之后应当能建成索引：%v", err)
	}
}
