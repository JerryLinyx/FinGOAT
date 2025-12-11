"""
Add Real Financial Documents to Knowledge Base

This script helps you add REAL financial documents like:
- SEC filings (10-K, 10-Q, 8-K)
- Earnings call transcripts
- Analyst research reports
- Company investor presentations
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment
env_file = Path(__file__).parent.parent.parent.parent.parent.parent / "langchain-v1" / ".env.trading"
if env_file.exists():
    load_dotenv(dotenv_path=env_file)
else:
    load_dotenv()

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent))

from tradingagents.agents.analysts.rag import FundamentalsRAGRetriever
from tradingagents.dataflows.config import get_config


def add_sec_filing_from_text(ticker: str, filing_text: str, filing_type: str, date: str):
    """Add a real SEC filing document.
    
    Args:
        ticker: Stock ticker (e.g., "AAPL")
        filing_text: Full text content of the SEC filing
        filing_type: Type of filing (e.g., "10-K", "10-Q", "8-K")
        date: Filing date (YYYY-MM-DD)
    """
    config = get_config()
    retriever = FundamentalsRAGRetriever(config=config)
    
    metadata = {
        "ticker": ticker,
        "doc_type": f"sec_filing_{filing_type.lower()}",
        "date": date,
        "source": "sec_edgar",
        "title": f"{ticker} {filing_type} Filing - {date}"
    }
    
    retriever.add_documents([filing_text], [metadata])
    
    # Save to text file
    kb_dir = Path(config.get("project_dir", ".")) / "knowledge_base" / "txt_documents"
    kb_dir.mkdir(parents=True, exist_ok=True)
    
    filename = f"sec_{ticker}_{filing_type}_{date}.txt"
    filepath = kb_dir / filename
    
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"Title: {metadata['title']}\n")
        f.write(f"Type: {metadata['doc_type']}\n")
        f.write(f"Date: {date}\n")
        f.write(f"Source: {metadata['source']}\n")
        f.write(f"Ticker: {ticker}\n")
        f.write("=" * 80 + "\n\n")
        f.write(filing_text)
    
    print(f"✅ Added SEC filing: {filename}")
    return filepath


def add_earnings_transcript(ticker: str, transcript_text: str, quarter: str, year: str, date: str):
    """Add a real earnings call transcript.
    
    Args:
        ticker: Stock ticker
        transcript_text: Full transcript text
        quarter: Quarter (e.g., "Q4")
        year: Year (e.g., "2024")
        date: Call date (YYYY-MM-DD)
    """
    config = get_config()
    retriever = FundamentalsRAGRetriever(config=config)
    
    metadata = {
        "ticker": ticker,
        "doc_type": "earnings_transcript",
        "date": date,
        "source": "earnings_call",
        "quarter": quarter,
        "year": year,
        "title": f"{ticker} {quarter} {year} Earnings Call Transcript"
    }
    
    retriever.add_documents([transcript_text], [metadata])
    
    # Save to text file
    kb_dir = Path(config.get("project_dir", ".")) / "knowledge_base" / "txt_documents"
    kb_dir.mkdir(parents=True, exist_ok=True)
    
    filename = f"earnings_{ticker}_{quarter}_{year}_{date}.txt"
    filepath = kb_dir / filename
    
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"Title: {metadata['title']}\n")
        f.write(f"Type: {metadata['doc_type']}\n")
        f.write(f"Date: {date}\n")
        f.write(f"Source: {metadata['source']}\n")
        f.write(f"Ticker: {ticker}\n")
        f.write(f"Quarter: {quarter} {year}\n")
        f.write("=" * 80 + "\n\n")
        f.write(transcript_text)
    
    print(f"✅ Added earnings transcript: {filename}")
    return filepath


def add_analyst_report(ticker: str, report_text: str, firm: str, date: str, rating: str = None):
    """Add a real analyst research report.
    
    Args:
        ticker: Stock ticker
        report_text: Full report text
        firm: Analyst firm name (e.g., "Goldman Sachs", "Morgan Stanley")
        date: Report date (YYYY-MM-DD)
        rating: Optional rating (e.g., "Buy", "Hold", "Sell")
    """
    config = get_config()
    retriever = FundamentalsRAGRetriever(config=config)
    
    metadata = {
        "ticker": ticker,
        "doc_type": "analyst_report",
        "date": date,
        "source": firm.lower().replace(" ", "_"),
        "title": f"{firm} Research Report - {ticker} - {date}"
    }
    
    if rating:
        metadata["rating"] = rating
    
    retriever.add_documents([report_text], [metadata])
    
    # Save to text file
    kb_dir = Path(config.get("project_dir", ".")) / "knowledge_base" / "txt_documents"
    kb_dir.mkdir(parents=True, exist_ok=True)
    
    filename = f"analyst_{ticker}_{firm.replace(' ', '_')}_{date}.txt"
    filepath = kb_dir / filename
    
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"Title: {metadata['title']}\n")
        f.write(f"Type: {metadata['doc_type']}\n")
        f.write(f"Date: {date}\n")
        f.write(f"Source: {firm}\n")
        f.write(f"Ticker: {ticker}\n")
        if rating:
            f.write(f"Rating: {rating}\n")
        f.write("=" * 80 + "\n\n")
        f.write(report_text)
    
    print(f"✅ Added analyst report: {filename}")
    return filepath


def add_from_file(file_path: str, ticker: str, doc_type: str, date: str, source: str, **kwargs):
    """Add a document from a text file.
    
    Args:
        file_path: Path to text file
        ticker: Stock ticker
        doc_type: Document type (e.g., "sec_filing_10k", "earnings_transcript")
        date: Document date (YYYY-MM-DD)
        source: Source of document
        **kwargs: Additional metadata
    """
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    config = get_config()
    retriever = FundamentalsRAGRetriever(config=config)
    
    metadata = {
        "ticker": ticker,
        "doc_type": doc_type,
        "date": date,
        "source": source,
        "title": f"{ticker} {doc_type} - {date}"
    }
    metadata.update(kwargs)
    
    retriever.add_documents([content], [metadata])
    
    # Copy to knowledge base directory
    kb_dir = Path(config.get("project_dir", ".")) / "knowledge_base" / "txt_documents"
    kb_dir.mkdir(parents=True, exist_ok=True)
    
    filename = Path(file_path).name
    filepath = kb_dir / filename
    
    import shutil
    shutil.copy2(file_path, filepath)
    
    print(f"✅ Added document from file: {filename}")
    return filepath


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Add real financial documents to RAG knowledge base")
    parser.add_argument("--sec-filing", action="store_true", help="Add SEC filing")
    parser.add_argument("--earnings", action="store_true", help="Add earnings transcript")
    parser.add_argument("--analyst", action="store_true", help="Add analyst report")
    parser.add_argument("--file", type=str, help="Add from text file")
    parser.add_argument("--ticker", type=str, required=True, help="Stock ticker")
    parser.add_argument("--date", type=str, required=True, help="Date (YYYY-MM-DD)")
    parser.add_argument("--filing-type", type=str, help="SEC filing type (10-K, 10-Q, etc.)")
    parser.add_argument("--quarter", type=str, help="Quarter (Q1, Q2, Q3, Q4)")
    parser.add_argument("--year", type=str, help="Year")
    parser.add_argument("--firm", type=str, help="Analyst firm name")
    parser.add_argument("--rating", type=str, help="Analyst rating")
    parser.add_argument("--doc-type", type=str, help="Document type for file input")
    parser.add_argument("--source", type=str, help="Document source")
    
    args = parser.parse_args()
    
    if args.file:
        if not all([args.doc_type, args.source]):
            print("Error: --doc-type and --source required when using --file")
            sys.exit(1)
        add_from_file(args.file, args.ticker, args.doc_type, args.date, args.source)
    elif args.sec_filing:
        if not args.filing_type:
            print("Error: --filing-type required for SEC filings")
            sys.exit(1)
        print("Paste SEC filing text (end with Ctrl+D or empty line):")
        filing_text = sys.stdin.read()
        add_sec_filing_from_text(args.ticker, filing_text, args.filing_type, args.date)
    elif args.earnings:
        if not all([args.quarter, args.year]):
            print("Error: --quarter and --year required for earnings transcripts")
            sys.exit(1)
        print("Paste earnings transcript text (end with Ctrl+D or empty line):")
        transcript_text = sys.stdin.read()
        add_earnings_transcript(args.ticker, transcript_text, args.quarter, args.year, args.date)
    elif args.analyst:
        if not args.firm:
            print("Error: --firm required for analyst reports")
            sys.exit(1)
        print("Paste analyst report text (end with Ctrl+D or empty line):")
        report_text = sys.stdin.read()
        add_analyst_report(args.ticker, report_text, args.firm, args.date, args.rating)
    else:
        print("Please specify --sec-filing, --earnings, --analyst, or --file")
        parser.print_help()

