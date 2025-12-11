# RAG System for Fundamentals Analyst

This directory contains the Retrieval-Augmented Generation (RAG) system for the Fundamentals Analyst agent. The RAG system enhances fundamental analysis by retrieving relevant financial documents, SEC filings, earnings transcripts, and analyst reports from a knowledge base.

## Overview

The RAG system:
1. **Retrieves** relevant context from a ChromaDB knowledge base based on the stock ticker
2. **Injects** the retrieved context into the analyst's prompt
3. **Saves** the injected content to a text file for auditing and debugging

## Files

- `rag_retriever.py`: Main RAG retriever class that handles document retrieval and context formatting
- `populate_knowledge_base.py`: Utility script to add documents to the knowledge base
- `__init__.py`: Module initialization

## How It Works

### 1. Retrieval Process

When the Fundamentals Analyst is invoked:
1. The RAG retriever generates a query based on the stock ticker
2. It searches the ChromaDB knowledge base using semantic similarity
3. It retrieves the top-k most relevant documents (default: 5)
4. It formats the retrieved documents into a context string

### 2. Context Injection

The retrieved context is injected into the analyst's system prompt:
- The context is clearly marked as "ADDITIONAL CONTEXT FROM KNOWLEDGE BASE"
- The analyst is instructed to use this context to enhance analysis
- The analyst is told to prioritize real-time tool data if there are discrepancies

### 3. File Saving

The injected RAG context is automatically saved to:
```
rag_outputs/fundamentals/rag_context_{ticker}_{trade_date}_{timestamp}.txt
```

Each file contains:
- Query used for retrieval
- Number of results retrieved
- Full context text
- Detailed document information (similarity scores, metadata)

## Usage

### Adding Documents to Knowledge Base

#### Option 1: Add Example Documents
```bash
cd TradingAgents
python -m tradingagents.agents.analysts.rag.populate_knowledge_base --example
```

#### Option 2: Add from a Single File
```bash
python -m tradingagents.agents.analysts.rag.populate_knowledge_base \
    --file path/to/document.txt \
    --ticker AAPL \
    --doc-type earnings \
    --date 2024-10-31 \
    --source company_earnings
```

#### Option 3: Add from a Directory
```bash
python -m tradingagents.agents.analysts.rag.populate_knowledge_base \
    --directory path/to/documents/ \
    --ticker AAPL \
    --doc-type sec_filing
```

### Programmatic Usage

```python
from tradingagents.agents.analysts.rag import FundamentalsRAGRetriever
from tradingagents.dataflows.config import get_config

config = get_config()
retriever = FundamentalsRAGRetriever(config=config)

# Add documents
documents = ["Document 1 text...", "Document 2 text..."]
metadatas = [
    {"ticker": "AAPL", "doc_type": "earnings", "date": "2024-10-31", "source": "company"},
    {"ticker": "MSFT", "doc_type": "earnings", "date": "2024-10-24", "source": "company"}
]
retriever.add_documents(documents, metadatas)

# Retrieve context
result = retriever.retrieve("AAPL", top_k=5)
print(result["context"])
```

## Document Metadata Schema

When adding documents, include the following metadata fields:

- `ticker` (required): Stock ticker symbol (e.g., "AAPL")
- `doc_type`: Type of document (e.g., "earnings", "sec_filing", "analyst_report", "transcript")
- `date`: Document date in YYYY-MM-DD format
- `source`: Source of the document (e.g., "company_earnings", "sec_edgar", "analyst_firm")
- `quarter`: Quarter (e.g., "Q4") - optional
- `year`: Year (e.g., "2024") - optional

## Configuration

The RAG system uses the same embedding configuration as the memory system:

- `EMBED_MODEL`: Embedding model (default: "text-embedding-3-small")
- `EMBED_BASE_URL`: Base URL for embedding API (default: "https://api.openai.com/v1")
- `EMBED_API_KEY` or `OPENAI_API_KEY`: API key for embeddings

## Output Files

RAG context files are saved in: `rag_outputs/fundamentals/`

File naming format: `rag_context_{ticker}_{trade_date}_{timestamp}.txt`

Example: `rag_context_AAPL_2024-05-10_20240510_143022.txt`

## Integration

The RAG system is automatically integrated into the Fundamentals Analyst. No additional configuration is needed - it will:
- Retrieve context when the analyst runs
- Inject context into the prompt
- Save context to files
- Return metadata in the state (including file path and number of results)

## Future Enhancements

Potential improvements:
- Support for multiple knowledge bases (SEC filings, earnings transcripts, analyst reports)
- Hybrid search (semantic + keyword)
- Reranking of retrieved documents
- Automatic document ingestion from external sources (SEC EDGAR, company websites)
- Support for PDF and other document formats

