"""
Create Finance Knowledge Base for RAG System

This script populates the ChromaDB knowledge base with financial documents
and saves them as text files. Can be run while the system is running.
"""

import os
import sys
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env.trading
env_file = Path(__file__).parent.parent.parent.parent.parent.parent / "langchain-v1" / ".env.trading"
if env_file.exists():
    load_dotenv(dotenv_path=env_file)
    print(f"Loaded environment from: {env_file}")
else:
    # Fallback to .env
    load_dotenv()
    print("Loaded environment from: .env")

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent))

from tradingagents.agents.analysts.rag import FundamentalsRAGRetriever
from tradingagents.dataflows.config import get_config


# Financial knowledge base documents
FINANCIAL_KNOWLEDGE_BASE = [
    {
        "ticker": "GENERAL",
        "doc_type": "financial_concepts",
        "date": "2024-01-01",
        "source": "finance_knowledge_base",
        "title": "Financial Statement Analysis Fundamentals",
        "content": """
Financial Statement Analysis Fundamentals

1. Balance Sheet Analysis:
   - Current Ratio: Current Assets / Current Liabilities (ideal: > 1.5)
   - Quick Ratio: (Current Assets - Inventory) / Current Liabilities (ideal: > 1.0)
   - Debt-to-Equity Ratio: Total Debt / Total Equity (ideal: < 0.5 for conservative companies)
   - Working Capital: Current Assets - Current Liabilities (positive is good)

2. Income Statement Analysis:
   - Gross Profit Margin: (Revenue - COGS) / Revenue (higher is better)
   - Operating Margin: Operating Income / Revenue (shows operational efficiency)
   - Net Profit Margin: Net Income / Revenue (overall profitability)
   - Earnings Per Share (EPS): Net Income / Shares Outstanding
   - Revenue Growth Rate: (Current Revenue - Previous Revenue) / Previous Revenue

3. Cash Flow Statement Analysis:
   - Operating Cash Flow: Should be positive and growing
   - Free Cash Flow: Operating Cash Flow - Capital Expenditures
   - Cash Flow from Operations / Net Income: Should be > 1.0 (indicates quality earnings)
   - Cash Conversion Cycle: Days Inventory + Days Receivable - Days Payable (lower is better)

4. Key Valuation Metrics:
   - Price-to-Earnings (P/E) Ratio: Stock Price / EPS (compare to industry average)
   - Price-to-Book (P/B) Ratio: Market Cap / Book Value (lower may indicate undervaluation)
   - Price-to-Sales (P/S) Ratio: Market Cap / Revenue
   - Enterprise Value (EV): Market Cap + Debt - Cash
   - EV/EBITDA: Enterprise Value / EBITDA (lower may indicate better value)

5. Red Flags to Watch:
   - Declining revenue growth
   - Increasing debt levels
   - Negative free cash flow
   - Declining profit margins
   - High inventory levels relative to sales
   - Accounts receivable growing faster than revenue
   - Frequent accounting restatements
        """
    },
    {
        "ticker": "GENERAL",
        "doc_type": "financial_concepts",
        "date": "2024-01-01",
        "source": "finance_knowledge_base",
        "title": "Earnings Quality Indicators",
        "content": """
Earnings Quality Indicators

High-Quality Earnings Signs:
1. Consistent revenue growth over multiple quarters
2. Operating cash flow exceeds net income
3. Gross margins stable or improving
4. Low reliance on one-time gains or accounting adjustments
5. Accounts receivable growth in line with revenue growth
6. Inventory turnover consistent or improving
7. Low debt levels with manageable interest coverage
8. Transparent financial reporting with minimal restatements

Low-Quality Earnings Warning Signs:
1. Net income growing but operating cash flow declining
2. Large one-time charges or gains
3. Aggressive revenue recognition practices
4. Accounts receivable growing much faster than revenue
5. Inventory buildup without corresponding sales growth
6. Frequent use of non-GAAP adjustments
7. Related-party transactions that may inflate revenue
8. Changes in accounting methods that boost earnings

Key Ratios for Earnings Quality:
- Cash Flow from Operations / Net Income: Should be consistently > 1.0
- Days Sales Outstanding (DSO): Should be stable or decreasing
- Inventory Days: Should be stable or decreasing
- Accruals Ratio: (Net Income - Operating Cash Flow) / Total Assets (lower is better)
        """
    },
    {
        "ticker": "GENERAL",
        "doc_type": "sector_analysis",
        "date": "2024-01-01",
        "source": "finance_knowledge_base",
        "title": "Technology Sector Financial Benchmarks",
        "content": """
Technology Sector Financial Benchmarks

Typical Tech Company Metrics:
1. Revenue Growth: High-growth tech companies typically show 20-50%+ YoY growth
2. Gross Margins: Software companies: 70-90%, Hardware: 30-50%, Services: 40-60%
3. Operating Margins: Mature tech: 15-30%, Growth stage: 5-15%, Early stage: negative
4. R&D Spending: Typically 10-25% of revenue for innovation-focused companies
5. Sales & Marketing: Often 20-40% of revenue for growth-stage companies

Key Tech Sector Ratios:
- P/E Ratios: Growth tech: 25-50x, Mature tech: 15-25x
- Price-to-Sales: Growth: 5-15x, Mature: 3-8x
- EV/Revenue: Growth: 8-20x, Mature: 4-10x
- Free Cash Flow Yield: Mature: 3-8%, Growth: often negative initially

Tech Sector Red Flags:
- Declining user growth or engagement metrics
- Increasing customer acquisition costs
- High churn rates for SaaS companies
- Regulatory risks (privacy, antitrust)
- Technology obsolescence risk
- High dependence on key personnel or products
        """
    },
    {
        "ticker": "GENERAL",
        "doc_type": "sector_analysis",
        "date": "2024-01-01",
        "source": "finance_knowledge_base",
        "title": "Healthcare & Biotech Sector Analysis",
        "content": """
Healthcare & Biotech Sector Analysis

Key Metrics for Healthcare Companies:
1. Revenue Growth: Established pharma: 3-8%, Biotech: highly variable based on pipeline
2. Gross Margins: Pharma: 70-85%, Biotech: variable, often negative pre-commercialization
3. R&D as % of Revenue: Pharma: 15-25%, Biotech: 50-100%+ (pre-revenue)
4. Operating Margins: Mature pharma: 20-35%, Biotech: negative until commercialization

Pipeline Analysis (Biotech):
- Phase 1 success rate: ~63%
- Phase 2 success rate: ~31%
- Phase 3 success rate: ~58%
- FDA approval rate: ~85% of Phase 3 submissions
- Time to market: 10-15 years from discovery

Key Healthcare Ratios:
- P/E Ratios: Mature pharma: 12-20x, Biotech: often N/A (no earnings)
- Price-to-Sales: Biotech: 5-20x (pre-revenue), Mature: 3-6x
- R&D Efficiency: Revenue per R&D dollar spent

Healthcare Sector Considerations:
- Regulatory approval risks (FDA, EMA)
- Patent expiration (patent cliff)
- Generic competition
- Reimbursement changes
- Clinical trial outcomes
- Pipeline depth and quality
        """
    },
    {
        "ticker": "GENERAL",
        "doc_type": "valuation_methods",
        "date": "2024-01-01",
        "source": "finance_knowledge_base",
        "title": "Company Valuation Methods",
        "content": """
Company Valuation Methods

1. Discounted Cash Flow (DCF) Analysis:
   - Project future free cash flows
   - Apply discount rate (WACC: Weighted Average Cost of Capital)
   - Calculate terminal value
   - Sum present values
   - Key assumptions: growth rates, discount rate, terminal multiple

2. Comparable Company Analysis (Comps):
   - Find similar companies in same industry
   - Calculate valuation multiples (P/E, EV/EBITDA, P/S)
   - Apply median or mean multiples to target company
   - Adjust for differences in growth, margins, risk

3. Precedent Transactions:
   - Analyze recent M&A transactions in industry
   - Calculate transaction multiples
   - Apply to target company
   - Often includes control premium (20-40%)

4. Asset-Based Valuation:
   - Sum of all assets minus liabilities
   - Useful for asset-heavy businesses
   - May not capture intangible value

5. Key Valuation Multiples:
   - P/E Ratio: For profitable companies
   - EV/EBITDA: Better for companies with different capital structures
   - P/S Ratio: For companies without earnings
   - P/B Ratio: For asset-heavy companies
   - PEG Ratio: P/E / Growth Rate (lower is better, < 1.0 is attractive)

6. Growth-Adjusted Metrics:
   - PEG Ratio: P/E divided by growth rate
   - EV/Revenue Growth: Enterprise Value / Revenue Growth Rate
   - Rule of 40 (SaaS): Revenue Growth % + Profit Margin % should be > 40%
        """
    },
    {
        "ticker": "GENERAL",
        "doc_type": "risk_analysis",
        "date": "2024-01-01",
        "source": "finance_knowledge_base",
        "title": "Financial Risk Assessment Framework",
        "content": """
Financial Risk Assessment Framework

1. Credit Risk Indicators:
   - Interest Coverage Ratio: EBIT / Interest Expense (should be > 3x)
   - Debt-to-Equity Ratio: Total Debt / Total Equity
   - Current Ratio: Current Assets / Current Liabilities
   - Quick Ratio: (Current Assets - Inventory) / Current Liabilities
   - Altman Z-Score: Bankruptcy prediction model

2. Liquidity Risk:
   - Current Ratio: < 1.0 indicates potential liquidity issues
   - Quick Ratio: < 0.5 is concerning
   - Cash Ratio: Cash / Current Liabilities
   - Operating Cash Flow / Current Liabilities: Should be > 1.0

3. Operational Risk:
   - Revenue concentration: > 20% from one customer is risky
   - Geographic concentration: Over-reliance on one market
   - Product concentration: Single product dependency
   - Key person risk: Dependence on founder/CEO

4. Market Risk:
   - Beta: Stock volatility vs market (1.0 = market average)
   - Correlation with market indices
   - Sector-specific risks (regulatory, cyclical)

5. Financial Statement Red Flags:
   - Revenue recognition changes
   - Frequent restatements
   - Auditor changes
   - Related-party transactions
   - Off-balance sheet liabilities
   - Unusual accounting practices

6. Quality of Earnings Checklist:
   - Operating cash flow > net income
   - Consistent accounting policies
   - Transparent disclosures
   - Realistic growth assumptions
   - Sustainable business model
        """
    }
]


def create_finance_knowledge_base():
    """Create and populate the finance knowledge base."""
    print("=" * 80)
    print("Creating Finance Knowledge Base for RAG System")
    print("=" * 80)
    print()
    
    # Initialize RAG retriever
    config = get_config()
    retriever = FundamentalsRAGRetriever(config=config)
    
    # Create knowledge base directory
    kb_dir = Path(config.get("project_dir", ".")) / "knowledge_base" / "txt_documents"
    kb_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"Knowledge base directory: {kb_dir}")
    print()
    
    documents = []
    metadatas = []
    saved_files = []
    
    # Process each document
    for i, doc in enumerate(FINANCIAL_KNOWLEDGE_BASE):
        content = doc["content"].strip()
        metadata = {
            "ticker": doc["ticker"],
            "doc_type": doc["doc_type"],
            "date": doc["date"],
            "source": doc["source"],
            "title": doc.get("title", f"Document {i+1}")
        }
        
        documents.append(content)
        metadatas.append(metadata)
        
        # Save as text file
        filename = f"{doc['doc_type']}_{doc['title'].replace(' ', '_').replace('/', '_')}.txt"
        filepath = kb_dir / filename
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(f"Title: {doc.get('title', 'Untitled')}\n")
            f.write(f"Type: {doc['doc_type']}\n")
            f.write(f"Date: {doc['date']}\n")
            f.write(f"Source: {doc['source']}\n")
            f.write(f"Ticker: {doc['ticker']}\n")
            f.write("=" * 80 + "\n\n")
            f.write(content)
        
        saved_files.append(str(filepath))
        print(f"✓ Saved: {filename}")
    
    # Add to ChromaDB
    print()
    print("Adding documents to ChromaDB...")
    try:
        retriever.add_documents(documents, metadatas)
        print(f"✓ Successfully added {len(documents)} documents to ChromaDB")
    except Exception as e:
        print(f"✗ Error adding to ChromaDB: {e}")
        return False
    
    # Verify retrieval
    print()
    print("Testing retrieval...")
    test_query = "What are the key financial ratios for analyzing a company's fundamentals?"
    result = retriever.retrieve(
        ticker="GENERAL",
        query=test_query,
        top_k=3
    )
    
    print(f"✓ Retrieved {result['num_results']} documents for test query")
    print()
    print("=" * 80)
    print("Knowledge Base Creation Complete!")
    print("=" * 80)
    print()
    print(f"Total documents: {len(documents)}")
    print(f"Text files saved to: {kb_dir}")
    print(f"Embeddings stored in: ChromaDB collection 'fundamentals_knowledge_base'")
    print()
    print("The Fundamentals Analyst will now automatically use this knowledge base!")
    print()
    
    return True


if __name__ == "__main__":
    success = create_finance_knowledge_base()
    sys.exit(0 if success else 1)

