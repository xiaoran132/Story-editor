package service

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var pngHeader = []byte("\x89PNG\r\n\x1a\n")

func pngOfSize(n int) []byte {
	b := make([]byte, 0, n)
	b = append(b, pngHeader...)
	return append(b, bytes.Repeat([]byte{0x42}, n-len(b))...)
}

func TestSaveImage_OK(t *testing.T) {
	root := t.TempDir()
	svc := NewUploadService(root, 1<<20)

	url, err := svc.SaveImage("avatar", bytes.NewReader(pngOfSize(2048)))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(url, UploadPathPrefix+"avatar/") || !strings.HasSuffix(url, ".png") {
		t.Fatalf("unexpected url: %q", url)
	}

	// 文件真的落盘了，且内容完整（嗅探读掉的头必须被拼回去）。
	rel := strings.TrimPrefix(url, UploadPathPrefix)
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("file not written: %v", err)
	}
	if len(data) != 2048 || !bytes.HasPrefix(data, pngHeader) {
		t.Fatalf("content truncated: %d bytes, head=%q", len(data), data[:8])
	}
}

// kind 决定落盘的一级目录，必须白名单化，否则就是路径穿越。
func TestSaveImage_RejectsBadKind(t *testing.T) {
	svc := NewUploadService(t.TempDir(), 1<<20)
	for _, kind := range []string{"", "../../etc", "avatar/../..", "unknown"} {
		if _, err := svc.SaveImage(kind, bytes.NewReader(pngOfSize(64))); err == nil {
			t.Fatalf("kind %q: expected rejection", kind)
		}
	}
}

func TestSaveImage_RejectsNonImage(t *testing.T) {
	svc := NewUploadService(t.TempDir(), 1<<20)
	if _, err := svc.SaveImage("cover", bytes.NewReader([]byte("MZ\x90\x00\x03\x00\x00\x00not really a png"))); err == nil {
		t.Fatal("expected rejection of disguised executable")
	}
}

// 超限必须报错，并且不能在磁盘上留下半成品。
func TestSaveImage_TooLargeLeavesNoFile(t *testing.T) {
	root := t.TempDir()
	svc := NewUploadService(root, 1024)

	if _, err := svc.SaveImage("cover", bytes.NewReader(pngOfSize(4096))); err == nil {
		t.Fatal("expected size-limit error")
	}

	var found []string
	_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err == nil && info != nil && !info.IsDir() {
			found = append(found, p)
		}
		return nil
	})
	if len(found) != 0 {
		t.Fatalf("half-written files left behind: %v", found)
	}
}
