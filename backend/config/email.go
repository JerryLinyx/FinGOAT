package config

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"os"
	"strings"

	"github.com/spf13/viper"
)

// EmailConfig holds SMTP connection settings loaded from config + env vars.
type EmailConfig struct {
	SMTPHost      string
	SMTPPort      int
	SMTPUser      string
	SMTPPassword  string
	FromAddress   string
	VerifyURLBase string
}

// LoadEmailConfig reads SMTP settings from Viper config with env var overrides.
// Env vars: SMTP_HOST, SMTP_USER, SMTP_PASSWORD, VERIFY_URL_BASE
func LoadEmailConfig() EmailConfig {
	host := viper.GetString("email.smtp_host")
	if v := os.Getenv("SMTP_HOST"); v != "" {
		host = v
	}
	user := viper.GetString("email.smtp_user")
	if v := os.Getenv("SMTP_USER"); v != "" {
		user = v
	}
	password := viper.GetString("email.smtp_password")
	if v := os.Getenv("SMTP_PASSWORD"); v != "" {
		password = v
	}
	from := viper.GetString("email.from_address")
	if from == "" {
		from = "FinGOAT <noreply@fingoat.app>"
	}
	base := viper.GetString("email.verify_url_base")
	if v := os.Getenv("VERIFY_URL_BASE"); v != "" {
		base = v
	}
	if base == "" {
		base = "http://localhost"
	}
	port := viper.GetInt("email.smtp_port")
	if port == 0 {
		port = 587
	}
	return EmailConfig{
		SMTPHost:      host,
		SMTPPort:      port,
		SMTPUser:      user,
		SMTPPassword:  password,
		FromAddress:   from,
		VerifyURLBase: base,
	}
}

// SendEmail sends a plain text + HTML multipart email via SMTP with STARTTLS.
// When SMTPHost is empty, the send is skipped and a log line is printed (dev mode).
func SendEmail(cfg EmailConfig, to, subject, textBody, htmlBody string) error {
	if cfg.SMTPHost == "" {
		fmt.Printf("[email] SMTP not configured — skipping email to %s | subject: %s\n", to, subject)
		return nil
	}

	addr := fmt.Sprintf("%s:%d", cfg.SMTPHost, cfg.SMTPPort)
	boundary := "fingoat_alt_boundary"

	msg := strings.Join([]string{
		fmt.Sprintf("From: %s", cfg.FromAddress),
		fmt.Sprintf("To: %s", to),
		fmt.Sprintf("Subject: %s", subject),
		"MIME-Version: 1.0",
		fmt.Sprintf(`Content-Type: multipart/alternative; boundary="%s"`, boundary),
		"",
		fmt.Sprintf("--%s", boundary),
		"Content-Type: text/plain; charset=UTF-8",
		"",
		textBody,
		"",
		fmt.Sprintf("--%s", boundary),
		"Content-Type: text/html; charset=UTF-8",
		"",
		htmlBody,
		"",
		fmt.Sprintf("--%s--", boundary),
	}, "\r\n")

	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return fmt.Errorf("smtp dial %s: %w", addr, err)
	}

	client, err := smtp.NewClient(conn, cfg.SMTPHost)
	if err != nil {
		return fmt.Errorf("smtp new client: %w", err)
	}
	defer client.Close()

	if ok, _ := client.Extension("STARTTLS"); ok {
		tlsCfg := &tls.Config{ServerName: cfg.SMTPHost}
		if err := client.StartTLS(tlsCfg); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}

	auth := smtp.PlainAuth("", cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPHost)
	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}

	fromAddr := extractEmailAddress(cfg.FromAddress)
	if err := client.Mail(fromAddr); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("smtp RCPT TO: %w", err)
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := fmt.Fprint(w, msg); err != nil {
		return fmt.Errorf("smtp write body: %w", err)
	}
	return w.Close()
}

// extractEmailAddress extracts the bare address from "Display Name <addr@example.com>".
func extractEmailAddress(from string) string {
	if i := strings.Index(from, "<"); i >= 0 {
		if j := strings.Index(from[i:], ">"); j >= 0 {
			return from[i+1 : i+j]
		}
	}
	return strings.TrimSpace(from)
}

// VerificationEmailBody returns (textBody, htmlBody) for an email verification email.
func VerificationEmailBody(displayName, verifyURL string) (string, string) {
	text := fmt.Sprintf(`Hi %s,

Please verify your email address by clicking the link below:

%s

This link expires in 24 hours.

If you didn't create a FinGOAT account, you can safely ignore this email.

— The FinGOAT Team`, displayName, verifyURL)

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2>Verify your email</h2>
  <p>Hi %s,</p>
  <p>Please verify your email address by clicking the button below:</p>
  <p style="margin:32px 0">
    <a href="%s" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
      Verify Email
    </a>
  </p>
  <p style="color:#6b7280;font-size:14px">
    Or copy this link: <a href="%s">%s</a>
  </p>
  <p style="color:#6b7280;font-size:14px">This link expires in 24 hours.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0">
  <p style="color:#9ca3af;font-size:12px">
    If you didn't create a FinGOAT account, you can safely ignore this email.
  </p>
</body>
</html>`, displayName, verifyURL, verifyURL, verifyURL)

	return text, html
}
