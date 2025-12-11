---BEGIN PROMPT---

[Style & Meta-Instructions]
High-fidelity scientific schematic, technical vector illustration, clean white background, distinct boundaries, academic textbook style. High resolution 4k, strictly 2D flat design with subtle isometric elements.

[LAYOUT CONFIGURATION]
* **Selected Layout**: Central Hub with parallel analyst spokes and downstream delivery to API/UI
* **Composition Logic**: Left data/persistence panel feeding a central circular multi-agent hub; right server stack for Go backend; far-right dashboard screen; bottom strip showing Docker/Nginx deployment rail
* **Color Palette**: Professional Pastel (Azure Blue, Slate Grey, Coral Orange, Mint Green).

[ZONE 1: LEFT PANEL - Data Ingestion & Persistence]
* **Container**: Tall left rectangular panel with a thin header bar
* **Visual Structure**: Top cluster of three cloud/API icons (satellite dish, newswire tower, document stack) for "Alpha Vantage / yfinance / Google News"; mid-level two stacked cylinders labeled "PostgreSQL" with small table tags (trading_analysis_tasks, trading_decisions); beside them a red cube labeled "Redis Cache"; bottom small folder icon labeled "data_cache"
* **Key Text Labels**: "[Market/News/Fundamental APIs]", "[PostgreSQL]", "[Redis]"

[ZONE 2: CENTER HUB - Multi-Agent Trading Graph (LangGraph)]
* **Container**: Central circular engine with a gear icon at the core labeled "LangGraph Orchestrator"
* **Visual Structure**: Outer ring of four rounded capsules arranged clockwise: candlestick chart icon "Market Analyst", newspaper icon "News Analyst", chat bubble with sentiment gauge "Social/Sentiment Analyst", ledger sheet icon "Fundamentals Analyst"; each capsule connects to a tiny magnifier node tagged "tools_*" indicating data pulls; arrows converge inward to a pair of opposing silhouettes "Bull Researcher" and "Bear Researcher" with a curved ping-pong arrow between them labeled "max_debate_rounds"; both feed a gavel icon "Research Manager" leading to an up-arrow trader badge "Trader"; downstream is a triangular loop of three caution/neutral/shield icons labeled "Risky / Neutral / Safe Analysts" with curved arrows cycling clockwise labeled "risk discuss"; the triangle points to a large shield "Risk Judge" which outputs a paper slip "Decision BUY/SELL/HOLD"
* **Key Text Labels**: "[LangGraph Orchestrator]", "[Market/News/Social/Fundamentals Analysts]", "[Bull vs Bear Debate]", "[Research Manager]", "[Trader]", "[Risky/Neutral/Safe]", "[Risk Judge]", "[Decision]"

[ZONE 3: MID-RIGHT STACK - Go Backend API (Gin+GORM+JWT)]
* **Container**: Vertical server rack panel to the right of the hub
* **Visual Structure**: Stacked server blades labeled (top to bottom) "Gin REST API /api/trading/*", "JWT Auth + Casbin RBAC", "GORM + Postgres client", "Redis client (sessions/cache)", "HTTP client TRADING_SERVICE_URL → Python service"
* **Key Text Labels**: "[Go Backend]", "[Health / Analyze / Stats]"

[ZONE 4: RIGHT PANEL - Frontend Dashboard & Users]
* **Container**: Rightmost wide monitor/laptop frame
* **Visual Structure**: Split screen showing a login card with username/password fields and toggle for light/dark; main dashboard grid with (a) multi-line chart and donut allocation chart, (b) card titled "TradingAnalysis" showing BUY/SELL/HOLD badge and confidence meter, (c) scrollable panel "Agent Rationales" with bullet text, (d) notification bell with badges; small toggles for LLM provider/model and watchlist chips
* **Key Text Labels**: "[Login/Register (JWT)]", "[TradingAnalysis Panel]", "[Agent Rationales]", "[Portfolio & Alerts]"

[ZONE 5: BOTTOM STRIP - Deployment & Edge (Docker Compose + Nginx)]
* **Container**: Bottom horizontal strip spanning the width
* **Visual Structure**: Row of six docked container boxes on a single network rail labeled "fingoat-network": cylinders "postgres", cube "redis", server box "backend", Python logo box "trading-service", browser window "frontend", and small reverse-proxy box "nginx:80"; network rail labeled "docker-compose orchestration"
* **Key Text Labels**: "[docker-compose]", "[nginx proxy]", "[fingoat-network]"

[CONNECTIONS]
1. Thick arrow from Zone 1 API cloud cluster to Zone 2 tool nodes labeled "Market prices + Fundamentals + News feeds".
2. Solid arrow from Zone 2 "Decision BUY/SELL/HOLD" slip to Zone 3 top blade labeled "HTTP JSON via /api/trading/analyze".
3. Double-headed arrow between Zone 3 "GORM + Postgres client" blade and Zone 1 PostgreSQL cylinders labeled "persist tasks/decisions".
4. Double-headed arrow between Zone 3 "Redis client" blade and Zone 1 Redis cube labeled "cache tokens/sessions".
5. Wide arrow from Zone 3 rack to Zone 4 monitor labeled "JWT-secured REST + SSE updates".
6. Curved dotted arrow looping between Zone 2 "Bull Researcher" and "Bear Researcher" capsules labeled "debate loop".
7. Curved clockwise arrows forming a triangle among Zone 2 "Risky/Neutral/Safe" icons labeled "iterative risk triage to Risk Judge".
8. Thin arrows from Zone 5 boxes upward: "backend" box to Zone 3 rack, "trading-service" box to Zone 2 hub, "frontend" box to Zone 4 monitor, routed through the "nginx:80" box.

---END PROMPT---
