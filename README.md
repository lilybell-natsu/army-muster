# Army Muster

Gather comrades, train them month by month, and build the strongest army. A text-and-numbers strategy game that runs in the browser and installs as a PWA.

仲間を集め、月ごとに鍛え、最強の軍を作る Web ゲーム(PWA)。グラフィックはなく、数値とレーダーチャートで遊ぶ。

## Play

- Open `index.html` through any static web server (GitHub Pages works). Add it to your home screen to play offline.
- Progress is saved automatically in the browser (`localStorage`). Nothing is sent anywhere.

## How it works

- **Monthly plan**: choose 0–3 battles (type and opponent: Weak / Even / Strong), a governing policy, and a retreat policy. Then run the month (5 turns).
- **Army**: 9 stats in 3 categories (PHYSICAL: POW / DEX / MOB, MENTAL: INT / TAC / VIS, SOCIAL: CMD / ELO / POL). Each soldier trains one stat per month. Roles are Commander / Infantry / Archer.
- **Scouting** (every January from year 2): districts with a yearly trait. You see the rank and specialty of most candidates; higher ranks are harder to win over.
- **Graduation**: after 5 years, soldiers go to the Empire or stay as Instructor / Bureaucrat / General. The quality of those sent to the Empire moves the domain class (1–5).

## Files

| File | Role |
|---|---|
| `index.html` | UI (screens, labels in English/Japanese) |
| `engine.js` | Game rules, DOM-free. All state is one JSON object |
| `names.js` | Character names (Japanese surnames) |
| `manifest.json`, `sw.js`, `icons/` | PWA (installable, offline) |
| `CHANGELOG.md` | Version history |
| `log/` | Development notes |

## Credits

Character names are a sample of surnames from 名字見聞録「登録名字一覧」 (http://www.myshop.co.jp/japancal/fname/names01.html).
キャラクターの名前は「名字見聞録」の登録名字一覧から一部を選んで使っています。
