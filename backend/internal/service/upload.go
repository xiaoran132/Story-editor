package service

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"backend/pkg"
)

// UploadPathPrefix 是上传文件对外暴露的 URL 前缀。
//
// 刻意挂在 /api/v1 命名空间下而不是裸 /uploads：生产 nginx 只有
// 「/api/v1/ → 后端 8080」和「/ → 前端 3000」两条 location，裸 /uploads 会被
// 转给 Next.js。挂进 /api/v1 则反代规则天然覆盖，前端拼 NEXT_PUBLIC_API_BASE
// 在 dev（绝对地址）和 prod（同源 /api/v1）下都正确。
// 与 main.go 的 api.Static("/uploads", cfg.UploadDir) 成对，改一处要改两处。
const UploadPathPrefix = "/api/v1/uploads/"

// uploadKinds 是允许的用途白名单。用途同时决定落盘的一级目录，
// 因此必须白名单化——否则 kind=../../etc 就是路径穿越。
var uploadKinds = map[string]bool{
	"avatar": true, // 用户头像
	"cover":  true, // 作品封面
}

// UploadService 把上传的图片落到本地磁盘。
//
// 无 repository 依赖：文件本身不入库，调用方拿到 URL 后自行写进
// users.avatar_url / stories.cover_url。
type UploadService struct {
	rootDir  string
	maxBytes int64
}

func NewUploadService(rootDir string, maxBytes int64) *UploadService {
	return &UploadService{rootDir: rootDir, maxBytes: maxBytes}
}

// SaveImage 校验并保存一张图片，返回可直接访问的 URL。
func (s *UploadService) SaveImage(kind string, r io.Reader) (string, error) {
	if !uploadKinds[kind] {
		return "", pkg.BadRequest("不支持的上传类型")
	}

	// 先读文件头做嗅探。文件比 512 字节还短是正常的（极小 GIF），
	// ErrUnexpectedEOF 不算失败，交给 DetectContentType 用现有字节判断。
	head := make([]byte, pkg.SniffLen)
	n, err := io.ReadFull(r, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return "", pkg.BadRequest("无法读取上传文件")
	}
	head = head[:n]

	ext, err := pkg.SniffImageExt(head)
	if err != nil {
		return "", err
	}

	key := pkg.NewObjectKey(kind, ext)
	dest := filepath.Join(s.rootDir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return "", pkg.InternalDefault()
	}

	f, err := os.Create(dest)
	if err != nil {
		return "", pkg.InternalDefault()
	}

	// 把嗅探时读掉的头拼回去继续写。
	// LimitReader 收 maxBytes+1：多写出来的那 1 字节就是「超限」的证据——
	// 不能只信 Content-Length，它由客户端填，可以撒谎。
	written, copyErr := io.Copy(f, io.LimitReader(io.MultiReader(bytes.NewReader(head), r), s.maxBytes+1))
	closeErr := f.Close()

	if copyErr != nil || closeErr != nil {
		os.Remove(dest)
		return "", pkg.InternalDefault()
	}
	if written > s.maxBytes {
		os.Remove(dest) // 半成品不留在磁盘上
		return "", pkg.NewBusinessErrorWithMessage(pkg.CodeImageTooLarge,
			fmt.Sprintf("图片超出大小限制（最大 %d MB）", s.maxBytes>>20))
	}

	return UploadPathPrefix + key, nil
}
