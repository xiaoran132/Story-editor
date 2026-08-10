package pkg

import (
	"strings"
	"testing"
)

// 各格式的最小文件头（只需前几个字节能被 http.DetectContentType 认出）。
var (
	pngHead  = []byte("\x89PNG\r\n\x1a\n")
	jpegHead = []byte("\xff\xd8\xff\xe0")
	gifHead  = []byte("GIF89a")
	webpHead = []byte("RIFF\x00\x00\x00\x00WEBPVP8 ")
)

func TestSniffImageExt_Allowed(t *testing.T) {
	cases := map[string][]byte{
		".png":  pngHead,
		".jpg":  jpegHead,
		".gif":  gifHead,
		".webp": webpHead,
	}
	for want, head := range cases {
		got, err := SniffImageExt(head)
		if err != nil {
			t.Fatalf("%s: unexpected error: %v", want, err)
		}
		if got != want {
			t.Fatalf("ext = %q, want %q", got, want)
		}
	}
}

// 核心安全断言：判类型只看文件头，不看扩展名/Content-Type。
// 把可执行文件改名成 .png 必须被挡下。
func TestSniffImageExt_RejectsDisguised(t *testing.T) {
	bad := map[string][]byte{
		"windows exe": []byte("MZ\x90\x00\x03\x00\x00\x00"),
		"elf":         []byte("\x7fELF\x02\x01\x01\x00"),
		// SVG 是故意排除的：它是 XML，可内嵌脚本，而上传目录同源直出。
		"svg":   []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"html":  []byte("<!DOCTYPE html><html><body>hi</body></html>"),
		"empty": nil,
	}
	for name, head := range bad {
		if _, err := SniffImageExt(head); err == nil {
			t.Fatalf("%s: expected rejection, got nil error", name)
		}
	}
}

func TestNewObjectKey(t *testing.T) {
	key := NewObjectKey("avatar", ".png")
	if !strings.HasPrefix(key, "avatar/") || !strings.HasSuffix(key, ".png") {
		t.Fatalf("unexpected key shape: %q", key)
	}
	// avatar/<yyyy-mm>/<uuid>.png
	if parts := strings.Split(key, "/"); len(parts) != 3 {
		t.Fatalf("expected 3 path segments, got %q", key)
	}
	// 文件名不含用户可控内容，两次调用必然不同（uuid）。
	if key == NewObjectKey("avatar", ".png") {
		t.Fatal("keys collided")
	}
}
