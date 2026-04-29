# GRE Quant Logger — Free Version

**Coach Aditya Goenka** · goenka.aditya.kol@gmail.com

A free GRE Quant practice tool with access to 2 subtopics, Easy + Medium difficulty, and up to 10 questions per session.

🔗 **Live app:** https://[YOUR-USERNAME].github.io/gre-free/gre_practice_logger_free.html  
💰 **Upgrade to Pro:** https://[YOUR-USERNAME].github.io/gre-free/pricing.html

## What's Included (Free)
- Practice from Bank: Percentages + Fractions & Decimals
- Easy and Medium difficulty only
- Up to 10 questions per session
- Practice Mode with instant feedback
- Manual Session Logger

## Upgrade to Pro (₹999 one-time)
- All 88 subtopics across 9 topics
- All 4 difficulty levels including Hard + Extreme Hard
- Unlimited questions per session
- Exam Mode with full timed analysis
- My Progress dashboard

## File Structure
```
gre-free/
├── gre_practice_logger_free.html   ← Main app
├── pricing.html                    ← Sales page
└── bank/
    ├── index.json                  ← Bank manifest
    └── arithmetic/
        ├── percentages.json
        └── fractions_decimals.json
```

## Running Locally
```bash
python3 -m http.server 8080
# Open http://localhost:8080/gre_practice_logger_free.html
```
Note: fetch() requires a server — file:// URLs won't work.
