# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in SlickENV, please report it responsibly.

**Do not open a public issue.** Instead, email us at **hello@slickspender.com** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within **48 hours** and aim to release a fix within **7 days** for critical issues.

## Supported Versions

| Version | Supported |
| --- | --- |
| Latest | Yes |
| < Latest | No |

We only provide security fixes for the latest published version.

## Encryption Details

SlickENV uses client-side encryption — private variables are encrypted before leaving your machine:

- **Algorithm**: AES-256-GCM
- **Key derivation**: PBKDF2-SHA256 with 100,000 iterations
- **IV**: Unique 12-byte IV per variable
- **Auth tags**: 128-bit for tamper detection
- **Server model**: Zero-knowledge — the server never sees plaintext values

## Responsible Disclosure

We appreciate the security research community. If you follow responsible disclosure practices, we commit to:

- Not pursuing legal action against you
- Working with you to understand and resolve the issue
- Crediting you in the release notes (unless you prefer anonymity)
