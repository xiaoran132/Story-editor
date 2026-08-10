package pkg

import (
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// 图片上传的纯工具层：只做「这段字节是不是我们认的图片」和「该存成什么名字」，
// 不碰文件系统、不碰业务——落盘在 service/upload.go。

// SniffLen 是嗅探所需的字节数。http.DetectContentType 最多只看前 512 字节。
const SniffLen = 512

// allowedImages 是白名单：嗅探出的 MIME → 落盘扩展名。
//
// 只认这四种。SVG 被**故意排除**：它是 XML，可内嵌 <script>，而上传目录是同源直出的
// 静态资源——放行 SVG 等于开一个存储型 XSS 的口子。
var allowedImages = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

// SniffImageExt 按**文件头字节**判断类型并返回落盘扩展名。
//
// 刻意不看 multipart 的 Content-Type，也不看原始文件名的后缀——两者都由客户端说了算，
// 把 evil.exe 改名成 a.png 就能骗过去。
func SniffImageExt(head []byte) (string, error) {
	mime := http.DetectContentType(head)
	ext, ok := allowedImages[mime]
	if !ok {
		return "", NewBusinessErrorWithMessage(CodeUnsupportedImage, "只支持 JPG / PNG / WebP / GIF 图片")
	}
	return ext, nil
}

// NewObjectKey 生成存储相对路径：<kind>/<yyyy-mm>/<uuid><ext>。
//
// 文件名一律用 uuid，**不保留用户上传的原始文件名**：既彻底规避路径穿越（../）与
// 控制字符，也免了重名覆盖。按月分目录，避免单目录堆到几十万文件后 ls/备份变慢。
func NewObjectKey(kind, ext string) string {
	return fmt.Sprintf("%s/%s/%s%s", kind, time.Now().Format("2006-01"), uuid.NewString(), ext)
}
