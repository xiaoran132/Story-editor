package pkg

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
)

// 对称加密工具：用于把用户级敏感数据（如自带的 LLM API key）加密后落库。
// AES-256-GCM（认证加密，防篡改）；密钥由任意长度的 secret 经 SHA-256 派生为 32 字节。
// 密文格式：base64( nonce(12B) || ciphertext+tag )。secret 来自 config.EncryptionKey，
// 与 JWT_SECRET 分离（签发 token 与加密数据用不同密钥）。

// Encrypt 用 secret 加密 plain，返回 base64 密文。plain 为空串时返回空串（约定「未配置」）。
func Encrypt(plain, secret string) (string, error) {
	if plain == "" {
		return "", nil
	}
	gcm, err := newGCM(secret)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	// Seal 把 nonce 作为前缀（dst=nonce），输出 nonce||ciphertext
	sealed := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt 用 secret 解密 base64 密文。空串返回空串。密文非法/被篡改/密钥不符均返回错误。
func Decrypt(cipherB64, secret string) (string, error) {
	if cipherB64 == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(cipherB64)
	if err != nil {
		return "", err
	}
	gcm, err := newGCM(secret)
	if err != nil {
		return "", err
	}
	ns := gcm.NonceSize()
	if len(raw) < ns {
		return "", errors.New("ciphertext too short")
	}
	nonce, ct := raw[:ns], raw[ns:]
	plain, err := gcm.Open(nil, nonce, ct, nil) // 认证失败（篡改/错误密钥）在此返错
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func newGCM(secret string) (cipher.AEAD, error) {
	key := sha256.Sum256([]byte(secret)) // 任意长度 secret → 32 字节 AES-256 密钥
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
