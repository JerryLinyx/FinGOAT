# Finance Knowledge Base for RAG System

## Overview

This knowledge base contains financial documents that enhance the Fundamentals Analyst's analysis through Retrieval-Augmented Generation (RAG). The system stores documents both as:
- **Text files** in `txt_documents/` for human readability
- **Embeddings in ChromaDB** for semantic search

## Architecture

```
Documents → Embeddings → ChromaDB (Vector Store)
     ↓
Text Files (Human Readable)
     ↓
Query → Semantic Search → Retrieve Relevant Docs → Augment LLM Prompt
```

## Knowledge Base Contents

### 1. Financial Statement Analysis Fundamentals
- Balance sheet analysis (ratios, working capital)
- Income statement analysis (margins, EPS)
- Cash flow statement analysis
- Key valuation metrics
- Red flags to watch

### 2. Earnings Quality Indicators
- High-quality earnings signs
- Low-quality earnings warning signs
- Key ratios for earnings quality

### 3. Technology Sector Financial Benchmarks
- Typical tech company metrics
- Key tech sector ratios
- Tech sector red flags

### 4. Healthcare & Biotech Sector Analysis
- Key metrics for healthcare companies
- Pipeline analysis (Phase 1-3 success rates)
- Healthcare sector considerations

### 5. Company Valuation Methods
- DCF analysis
- Comparable company analysis
- Precedent transactions
- Asset-based valuation
- Growth-adjusted metrics

### 6. Financial Risk Assessment Framework
- Credit risk indicators
- Liquidity risk
- Operational risk
- Market risk
- Financial statement red flags

## Files Created

### Text Documents
Location: `tradingagents/knowledge_base/txt_documents/`

- `financial_concepts_Financial_Statement_Analysis_Fundamentals.txt`
- `financial_concepts_Earnings_Quality_Indicators.txt`
- `sector_analysis_Technology_Sector_Financial_Benchmarks.txt`
- `sector_analysis_Healthcare_&_Biotech_Sector_Analysis.txt`
- `valuation_methods_Company_Valuation_Methods.txt`
- `risk_analysis_Financial_Risk_Assessment_Framework.txt`

### ChromaDB Storage
Location: `tradingagents/chroma_db/`

- Persistent vector database
- Collection: `fundamentals_knowledge_base`
- 6 documents with embeddings
- Enables semantic search

## How It Works

1. **When Fundamentals Analyst runs:**
   - Generates query based on ticker and analysis context
   - Searches ChromaDB for semantically similar documents
   - Retrieves top-k most relevant documents (default: 5)

2. **Context Injection:**
   - Retrieved documents are formatted into context string
   - Injected into the analyst's system prompt
   - Analyst uses this context to enhance analysis

3. **File Saving:**
   - RAG context is saved to `rag_outputs/fundamentals/rag_context_{ticker}_{date}_{timestamp}.txt`
   - Includes query, retrieved documents, similarity scores

## Adding More Documents

Run the creation script:
```bash
cd TradingAgents
python3 -m tradingagents.agents.analysts.rag.create_finance_kb
```

Or use the populate script for custom documents:
```bash
python3 -m tradingagents.agents.analysts.rag.populate_knowledge_base \
    --file path/to/document.txt \
    --ticker TICKER \
    --doc-type earnings \
    --date 2024-01-01 \
    --source company_earnings
```

## Verification

The knowledge base is automatically used by the Fundamentals Analyst. To verify:

```python
from tradingagents.agents.analysts.rag import FundamentalsRAGRetriever
from tradingagents.dataflows.config import get_config

config = get_config()
retriever = FundamentalsRAGRetriever(config=config)

# Check document count
print(f"Documents in KB: {retriever.collection.count()}")

# Test retrieval
result = retriever.retrieve("AAPL", "financial ratios", top_k=3)
print(f"Retrieved: {result['num_results']} documents")
```

## Status

✅ **Knowledge Base Created**: 6 financial documents
✅ **ChromaDB Populated**: Embeddings stored and searchable
✅ **Text Files Saved**: Human-readable documents available
✅ **RAG Integration**: Fundamentals Analyst automatically uses KB
✅ **System Running**: Can add documents while system is active

The RAG system is ready to enhance fundamental analysis with financial knowledge!

