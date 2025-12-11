"""Script to populate the RAG knowledge base with financial documents.

This script provides utilities to add documents to the fundamentals
knowledge base. You can use this to add SEC filings, earnings transcripts,
analyst reports, and other financial documents.
"""

import os
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent))

from tradingagents.agents.analysts.rag import FundamentalsRAGRetriever
from tradingagents.dataflows.config import get_config


def add_example_documents():
    """Add example documents to the knowledge base."""
    config = get_config()
    retriever = FundamentalsRAGRetriever(config=config)
    
    # Example documents - replace with your actual data sources
    example_documents = [
        {
            "content": """
            Apple Inc. (AAPL) Q4 2024 Earnings Summary:
            - Revenue: $89.5 billion, up 1% YoY
            - iPhone revenue: $43.8 billion, down 2.5% YoY
            - Services revenue: $22.3 billion, up 16% YoY
            - Mac revenue: $7.6 billion, up 25% YoY
            - iPad revenue: $6.4 billion, down 10% YoY
            - Wearables revenue: $9.3 billion, up 3% YoY
            - Gross margin: 45.2%, up from 44.2% last year
            - Net income: $22.9 billion, up 13% YoY
            - EPS: $1.46, up 13% YoY
            - Cash and cash equivalents: $29.9 billion
            - Total debt: $95.3 billion
            """,
            "metadata": {
                "ticker": "AAPL",
                "doc_type": "earnings",
                "date": "2024-10-31",
                "source": "company_earnings",
                "quarter": "Q4",
                "year": "2024"
            }
        },
        {
            "content": """
            Microsoft Corporation (MSFT) Q1 2025 Earnings Summary:
            - Revenue: $65.4 billion, up 18% YoY
            - Productivity and Business Processes: $19.2 billion, up 13% YoY
            - Intelligent Cloud: $28.5 billion, up 21% YoY
            - More Personal Computing: $17.7 billion, up 19% YoY
            - Azure revenue growth: 29% YoY
            - Office 365 Commercial revenue: up 15% YoY
            - LinkedIn revenue: up 8% YoY
            - Gross margin: 70.9%, up from 69.2% last year
            - Net income: $22.3 billion, up 27% YoY
            - EPS: $2.99, up 27% YoY
            """,
            "metadata": {
                "ticker": "MSFT",
                "doc_type": "earnings",
                "date": "2024-10-24",
                "source": "company_earnings",
                "quarter": "Q1",
                "year": "2025"
            }
        },
        {
            "content": """
            NVIDIA Corporation (NVDA) Q3 2025 Earnings Summary:
            - Revenue: $18.1 billion, up 206% YoY
            - Data Center revenue: $14.5 billion, up 279% YoY
            - Gaming revenue: $2.9 billion, up 81% YoY
            - Professional Visualization revenue: $416 million, up 108% YoY
            - Automotive revenue: $261 million, up 4% YoY
            - Gross margin: 75.0%, up from 53.6% last year
            - Net income: $9.2 billion, up 1,259% YoY
            - EPS: $3.71, up 1,259% YoY
            - Cash and cash equivalents: $18.3 billion
            """,
            "metadata": {
                "ticker": "NVDA",
                "doc_type": "earnings",
                "date": "2024-11-21",
                "source": "company_earnings",
                "quarter": "Q3",
                "year": "2025"
            }
        }
    ]
    
    documents = [doc["content"] for doc in example_documents]
    metadatas = [doc["metadata"] for doc in example_documents]
    
    print(f"Adding {len(documents)} documents to knowledge base...")
    retriever.add_documents(documents, metadatas)
    print("Documents added successfully!")
    
    # Test retrieval
    print("\nTesting retrieval for AAPL...")
    result = retriever.retrieve("AAPL", top_k=2)
    print(f"Retrieved {result['num_results']} documents")
    print(f"\nContext preview:\n{result['context'][:500]}...")


def add_documents_from_file(file_path: str, ticker: str, doc_type: str, date: str, source: str):
    """Add documents from a text file.
    
    Args:
        file_path: Path to the text file
        ticker: Stock ticker symbol
        doc_type: Type of document (e.g., "sec_filing", "earnings", "analyst_report")
        date: Date of the document (YYYY-MM-DD)
        source: Source of the document
    """
    config = get_config()
    retriever = FundamentalsRAGRetriever(config=config)
    
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    metadata = {
        "ticker": ticker,
        "doc_type": doc_type,
        "date": date,
        "source": source
    }
    
    retriever.add_documents([content], [metadata])
    print(f"Added document from {file_path} to knowledge base")


def add_documents_from_directory(directory: str, ticker: str, doc_type: str):
    """Add all text files from a directory.
    
    Args:
        directory: Directory containing text files
        ticker: Stock ticker symbol
        doc_type: Type of document
    """
    config = get_config()
    retriever = FundamentalsRAGRetriever(config=config)
    
    directory_path = Path(directory)
    text_files = list(directory_path.glob("*.txt"))
    
    documents = []
    metadatas = []
    
    for file_path in text_files:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        # Extract date from filename if possible (format: YYYY-MM-DD)
        date = file_path.stem[:10] if len(file_path.stem) >= 10 else "unknown"
        
        documents.append(content)
        metadatas.append({
            "ticker": ticker,
            "doc_type": doc_type,
            "date": date,
            "source": file_path.name
        })
    
    if documents:
        retriever.add_documents(documents, metadatas)
        print(f"Added {len(documents)} documents from {directory} to knowledge base")
    else:
        print(f"No text files found in {directory}")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Populate RAG knowledge base")
    parser.add_argument("--example", action="store_true", help="Add example documents")
    parser.add_argument("--file", type=str, help="Path to text file to add")
    parser.add_argument("--directory", type=str, help="Directory containing text files")
    parser.add_argument("--ticker", type=str, required=False, help="Stock ticker symbol")
    parser.add_argument("--doc-type", type=str, required=False, help="Document type")
    parser.add_argument("--date", type=str, required=False, help="Document date (YYYY-MM-DD)")
    parser.add_argument("--source", type=str, required=False, help="Document source")
    
    args = parser.parse_args()
    
    if args.example:
        add_example_documents()
    elif args.file:
        if not all([args.ticker, args.doc_type, args.date, args.source]):
            print("Error: --ticker, --doc-type, --date, and --source are required when using --file")
            sys.exit(1)
        add_documents_from_file(args.file, args.ticker, args.doc_type, args.date, args.source)
    elif args.directory:
        if not all([args.ticker, args.doc_type]):
            print("Error: --ticker and --doc-type are required when using --directory")
            sys.exit(1)
        add_documents_from_directory(args.directory, args.ticker, args.doc_type)
    else:
        print("Please specify --example, --file, or --directory")
        parser.print_help()

