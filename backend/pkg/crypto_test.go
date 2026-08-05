package pkg

import (
	"encoding/base64"
	"testing"
)

func TestEncryptDecrypt_RoundTrip(t *testing.T) {
	secret := "my-encryption-secret"
	for _, plain := range []string{"sk-abcdef1234567890", "中文密钥测试", "x"} {
		ct, err := Encrypt(plain, secret)
		if err != nil {
			t.Fatalf("encrypt: %v", err)
		}
		if ct == plain {
			t.Fatalf("密文不应等于明文")
		}
		got, err := Decrypt(ct, secret)
		if err != nil {
			t.Fatalf("decrypt: %v", err)
		}
		if got != plain {
			t.Fatalf("往返不一致：want %q got %q", plain, got)
		}
	}
}

func TestEncrypt_EmptyIsEmpty(t *testing.T) {
	ct, err := Encrypt("", "s")
	if err != nil || ct != "" {
		t.Fatalf("空串加密应返回空串，got %q err %v", ct, err)
	}
	pt, err := Decrypt("", "s")
	if err != nil || pt != "" {
		t.Fatalf("空串解密应返回空串，got %q err %v", pt, err)
	}
}

func TestDecrypt_WrongSecretFails(t *testing.T) {
	ct, _ := Encrypt("sk-secret-value", "right-secret")
	if _, err := Decrypt(ct, "wrong-secret"); err == nil {
		t.Fatalf("错误密钥应解密失败")
	}
}

func TestDecrypt_TamperedFails(t *testing.T) {
	ct, _ := Encrypt("sk-secret-value", "s")
	raw, _ := base64.StdEncoding.DecodeString(ct)
	raw[len(raw)-1] ^= 0xff // 篡改末字节（GCM tag）
	tampered := base64.StdEncoding.EncodeToString(raw)
	if _, err := Decrypt(tampered, "s"); err == nil {
		t.Fatalf("被篡改的密文应解密失败")
	}
}

func TestDecrypt_GarbageFails(t *testing.T) {
	if _, err := Decrypt("not-base64!!!", "s"); err == nil {
		t.Fatalf("非法 base64 应报错")
	}
}
