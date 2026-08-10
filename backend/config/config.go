package config

import (
	"fmt"

	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

type Config struct {
	DBHost     string `mapstructure:"DB_HOST"`
	DBPort     string `mapstructure:"DB_PORT"`
	DBUser     string `mapstructure:"DB_USER"`
	DBPassword string `mapstructure:"DB_PASSWORD"`
	DBName     string `mapstructure:"DB_NAME"`
	JWTSecret  string `mapstructure:"JWT_SECRET"`
	// EncryptionKey 用于对称加密用户级敏感数据（如自带的 LLM API key）。
	// 与 JWTSecret 分离：签发 token 与加密数据用不同密钥。生产必须改默认值。
	EncryptionKey string `mapstructure:"ENCRYPTION_KEY"`
	ServerPort    string `mapstructure:"SERVER_PORT"`
	AgentURL      string `mapstructure:"AGENT_URL"`
	// UploadDir 是上传图片的落盘根目录。默认相对路径 ./uploads —— 与
	// LoadHTMLGlob("../templates/*") 同一个约束：进程必须在 backend/ 下启动。
	// 容器/生产建议填绝对路径并挂持久卷，否则重建即丢图。
	UploadDir string `mapstructure:"UPLOAD_DIR"`
	// UploadMaxMB 是单张图片的大小上限（MB）。
	UploadMaxMB int `mapstructure:"UPLOAD_MAX_MB"`
}

// UploadMaxBytes 把配置的 MB 换算成字节，供 UploadService 使用。
func (c *Config) UploadMaxBytes() int64 {
	return int64(c.UploadMaxMB) << 20
}

func (c *Config) DSN() string {
	return fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=Asia/Shanghai",
		c.DBHost, c.DBUser, c.DBPassword, c.DBName, c.DBPort)
}

func Load(configPath string) (*Config, error) {
	// 加载 .env 到环境变量（存在则加载，不存在忽略）；随后由 viper 读取
	_ = godotenv.Load()

	v := viper.New()

	if configPath != "" {
		v.SetConfigFile(configPath)
	} else {
		v.SetConfigName("config")
		v.SetConfigType("yaml")
		v.AddConfigPath("./config")
		v.AddConfigPath(".")
	}

	v.AutomaticEnv()

	_ = v.BindEnv("DB_HOST")
	_ = v.BindEnv("DB_PORT")
	_ = v.BindEnv("DB_USER")
	_ = v.BindEnv("DB_PASSWORD")
	_ = v.BindEnv("DB_NAME")
	_ = v.BindEnv("JWT_SECRET")
	_ = v.BindEnv("ENCRYPTION_KEY")
	_ = v.BindEnv("SERVER_PORT")
	_ = v.BindEnv("AGENT_URL")
	_ = v.BindEnv("UPLOAD_DIR")
	_ = v.BindEnv("UPLOAD_MAX_MB")

	setDefaults(v)

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("read config: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	return &cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("DB_HOST", "localhost")
	v.SetDefault("DB_PORT", "5432")
	v.SetDefault("DB_USER", "postgres")
	v.SetDefault("DB_PASSWORD", "postgres")
	v.SetDefault("DB_NAME", "story_editor")
	v.SetDefault("JWT_SECRET", "change-me-in-production")
	v.SetDefault("ENCRYPTION_KEY", "change-me-encryption-key")
	v.SetDefault("SERVER_PORT", ":8080")
	v.SetDefault("AGENT_URL", "http://localhost:8001")
	v.SetDefault("UPLOAD_DIR", "./uploads")
	v.SetDefault("UPLOAD_MAX_MB", 5)
}
