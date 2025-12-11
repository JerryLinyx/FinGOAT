"""
TradingAgents FastAPI Microservice

This service provides REST API endpoints for the TradingAgents multi-agent trading framework.
It allows the Go backend to request trading analysis and recommendations.
"""

import os
import sys
import uuid
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum

from fastapi import FastAPI, HTTPException, BackgroundTasks, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from dotenv import load_dotenv

# Add TradingAgents to path
TRADING_AGENTS_PATH = os.path.join(os.path.dirname(__file__), "..", "TradingAgents")
sys.path.insert(0, TRADING_AGENTS_PATH)

from tradingagents.graph.trading_graph import TradingAgentsGraph
from tradingagents.default_config import DEFAULT_CONFIG

# Load environment variables from .env.trading (or .env if .env.trading doesn't exist)
env_file = ".env.trading" if os.path.exists(".env.trading") else ".env"
load_dotenv(dotenv_path=env_file)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
logger.info(f"Loading environment variables from: {env_file}")

# Initialize FastAPI app
app = FastAPI(
    title="TradingAgents Microservice",
    description="Multi-agent LLM financial trading analysis service",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory task storage (could be replaced with Redis in production)
analysis_tasks: Dict[str, Dict[str, Any]] = {}


# ======================== Models ========================

class TaskStatus(str, Enum):
    """Analysis task status"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class TradingAction(str, Enum):
    """Trading action types"""
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class LLMConfig(BaseModel):
    """LLM configuration"""
    deep_think_llm: str = Field(default="gpt-4o-mini", description="Deep thinking LLM model")
    quick_think_llm: str = Field(default="gpt-4o-mini", description="Quick thinking LLM model")
    max_debate_rounds: int = Field(default=1, ge=1, le=5, description="Maximum debate rounds")
    max_risk_discuss_rounds: int = Field(default=1, ge=1, le=5, description="Maximum risk discussion rounds")
    provider: str = Field(default="openai", description="LLM provider identifier")
    base_url: Optional[str] = Field(default=None, description="Override LLM base URL (for OpenAI-compatible endpoints)")
    api_key: Optional[str] = Field(default=None, description="Optional override for provider API key")


class DataVendorConfig(BaseModel):
    """Data vendor configuration"""
    core_stock_apis: str = Field(default="yfinance", description="Stock data provider")
    technical_indicators: str = Field(default="yfinance", description="Technical indicators provider")
    fundamental_data: str = Field(default="alpha_vantage", description="Fundamental data provider")
    news_data: str = Field(default="alpha_vantage", description="News data provider")


class AnalysisRequest(BaseModel):
    """Request model for trading analysis"""
    ticker: str = Field(..., description="Stock ticker symbol", example="NVDA")
    date: str = Field(..., description="Analysis date in YYYY-MM-DD format", example="2024-05-10")
    llm_config: Optional[LLMConfig] = Field(default=None, description="LLM configuration")
    data_vendor_config: Optional[DataVendorConfig] = Field(default=None, description="Data vendor configuration")
    
    @validator('ticker')
    def validate_ticker(cls, v):
        if not v or len(v) > 10:
            raise ValueError('Ticker must be between 1 and 10 characters')
        return v.upper()
    
    @validator('date')
    def validate_date(cls, v):
        try:
            datetime.strptime(v, '%Y-%m-%d')
        except ValueError:
            raise ValueError('Date must be in YYYY-MM-DD format')
        return v


class BatchAnalysisRequest(BaseModel):
    """Request model for batch analysis"""
    requests: List[AnalysisRequest] = Field(..., description="List of analysis requests")
    
    @validator('requests')
    def validate_batch_size(cls, v):
        if len(v) > 10:
            raise ValueError('Batch size cannot exceed 10 requests')
        return v


class AgentInsight(BaseModel):
    """Individual agent analysis result"""
    agent_type: str
    analysis: str
    confidence: Optional[float] = None


class DecisionReasoning(BaseModel):
    """Trading decision reasoning"""
    fundamental_analysis: Optional[Dict[str, Any]] = None
    sentiment_analysis: Optional[Dict[str, Any]] = None
    technical_analysis: Optional[Dict[str, Any]] = None
    news_analysis: Optional[Dict[str, Any]] = None
    risk_assessment: Optional[Dict[str, Any]] = None
    researcher_debate: Optional[Dict[str, Any]] = None


class TradingDecision(BaseModel):
    """Trading decision output"""
    action: str = Field(..., description="Trading action: BUY, SELL, or HOLD")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score")
    position_size: Optional[int] = Field(default=None, description="Recommended position size")
    reasoning: Optional[DecisionReasoning] = None
    raw_decision: Optional[Dict[str, Any]] = None


class AnalysisResponse(BaseModel):
    """Response model for analysis result"""
    task_id: str
    status: TaskStatus
    ticker: str
    date: str
    decision: Optional[TradingDecision] = None
    analysis_report: Optional[Dict[str, Any]] = None  # Complete analysis from all agents
    error: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None
    processing_time_seconds: Optional[float] = None


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    service: str
    version: str
    timestamp: str


# ======================== Helper Functions ========================

def build_config(request: AnalysisRequest) -> Dict[str, Any]:
    """Build TradingAgents configuration from request"""
    config = DEFAULT_CONFIG.copy()
    
    # Update LLM config if provided
    if request.llm_config:
        config["deep_think_llm"] = request.llm_config.deep_think_llm
        config["quick_think_llm"] = request.llm_config.quick_think_llm
        config["max_debate_rounds"] = request.llm_config.max_debate_rounds
        config["max_risk_discuss_rounds"] = request.llm_config.max_risk_discuss_rounds
        config["llm_provider"] = request.llm_config.provider
        if request.llm_config.base_url:
            config["backend_url"] = request.llm_config.base_url
        if request.llm_config.api_key:
            config["llm_api_key"] = request.llm_config.api_key
    
    # Update data vendor config if provided
    if request.data_vendor_config:
        config["data_vendors"] = {
            "core_stock_apis": request.data_vendor_config.core_stock_apis,
            "technical_indicators": request.data_vendor_config.technical_indicators,
            "fundamental_data": request.data_vendor_config.fundamental_data,
            "news_data": request.data_vendor_config.news_data,
        }
    
    return config


def extract_decision_info(decision_data: Any) -> TradingDecision:
    """Extract and structure trading decision information"""
    
    # Handle case where decision is a string (common TradingAgents output)
    if isinstance(decision_data, str):
        decision_text = decision_data.upper()
        
        # Extract action from string
        if "BUY" in decision_text:
            action = "BUY"
        elif "SELL" in decision_text:
            action = "SELL"
        elif "HOLD" in decision_text:
            action = "HOLD"
        else:
            action = "HOLD" # default
        
        # Estimate confidence based on language strength
        confidence = 0.7  # default moderate confidence
        if any(word in decision_text for word in ["STRONG", "HIGHLY", "VERY", "COMPELLING"]):
            confidence = 0.9
        elif any(word in decision_text for word in ["WEAK", "CAUTIOUS", "UNCERTAIN"]):
            confidence = 0.5
        
        return TradingDecision(
            action=action,
            confidence=confidence,
            raw_decision={"decision_text": decision_data}
        )
    
    # Handle case where decision is a dict
    elif isinstance(decision_data, dict):
        action = decision_data.get("action", "HOLD")
        confidence = decision_data.get("confidence", 0.5)
        
        return TradingDecision(
            action=action,
            confidence=confidence,
            position_size=decision_data.get("position_size"),
            raw_decision=decision_data
        )
    
    # Fallback
    else:
        logger.warning(f"Unexpected decision format: {type(decision_data)}")
        return TradingDecision(
            action="HOLD",
            confidence=0.0,
            raw_decision={"raw": str(decision_data)}
        )


def extract_analysis_report(state: Any) -> Dict[str, Any]:
    """Extract complete analysis report from TradingAgents state"""
    report = {}
    
    try:
        # State is typically a dict containing all agent outputs
        if isinstance(state, dict):
            # Extract各个agent的分析
            report = {
                "fundamental_analysis": state.get("fundamental_analysis"),
                "sentiment_analysis": state.get("sentiment_analysis"),
                "technical_analysis": state.get("technical_analysis"),
                "news_analysis": state.get("news_analysis"),
                "bull_researcher": state.get("bull_researcher"),
                "bear_researcher": state.get("bear_researcher"),
                "trader_analysis": state.get("trader_analysis"),
                "risk_assessment": state.get("risk_assessment"),
                "portfolio_manager": state.get("portfolio_manager"),
                "messages": state.get("messages"),  # 完整的对话历史
                "raw_state": state  # 保存完整的state以防需要
            }
            
            # Remove None values
            report = {k: v for k, v in report.items() if v is not None}
        else:
            report = {"raw_state": str(state)}
            
    except Exception as e:
        logger.error(f"Error extracting analysis report: {e}")
        report = {"error": str(e), "raw_state": str(state)}
    
    return report


def run_analysis(task_id: str, request: AnalysisRequest):
    """Run trading analysis (background task)"""
    try:
        logger.info(f"Starting analysis for task {task_id}: {request.ticker} on {request.date}")
        
        # Update task status
        analysis_tasks[task_id]["status"] = TaskStatus.PROCESSING
        
        start_time = datetime.now()
        
        # Build configuration
        config = build_config(request)
        
        # Initialize TradingAgents
        ta = TradingAgentsGraph(debug=True, config=config)
        
        # Run propagation
        state, decision = ta.propagate(request.ticker, request.date)
        
        end_time = datetime.now()
        processing_time = (end_time - start_time).total_seconds()
        
        # Extract decision information
        trading_decision = extract_decision_info(decision)
        
        # Extract complete analysis report from state
        analysis_report = extract_analysis_report(state)
        
        # Update task with results
        analysis_tasks[task_id].update({
            "status": TaskStatus.COMPLETED,
            "decision": trading_decision,
            "analysis_report": analysis_report,
            "completed_at": end_time.isoformat(),
            "processing_time_seconds": processing_time
        })
        
        logger.info(f"Completed analysis for task {task_id} in {processing_time:.2f}s")
        
    except Exception as e:
        logger.error(f"Error in analysis task {task_id}: {str(e)}", exc_info=True)
        analysis_tasks[task_id].update({
            "status": TaskStatus.FAILED,
            "error": str(e),
            "completed_at": datetime.now().isoformat()
        })


# ======================== API Endpoints ========================

@app.get("/", response_model=Dict[str, str])
async def root():
    """Root endpoint"""
    return {
        "service": "TradingAgents Microservice",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy",
        service="tradingagents-service",
        version="1.0.0",
        timestamp=datetime.now().isoformat()
    )


@app.post("/api/v1/analyze", response_model=AnalysisResponse, status_code=status.HTTP_202_ACCEPTED)
async def analyze_stock(request: AnalysisRequest, background_tasks: BackgroundTasks):
    """
    Initiate trading analysis for a stock
    
    This endpoint starts an asynchronous analysis task and returns immediately.
    Use the task_id to check the status and retrieve results.
    """
    task_id = str(uuid.uuid4())
    
    # Create task record
    analysis_tasks[task_id] = {
        "task_id": task_id,
        "status": TaskStatus.PENDING,
        "ticker": request.ticker,
        "date": request.date,
        "created_at": datetime.now().isoformat(),
        "decision": None,
        "analysis_report": None,
        "error": None,
        "completed_at": None,
        "processing_time_seconds": None
    }
    
    # Add background task
    background_tasks.add_task(run_analysis, task_id, request)
    
    return AnalysisResponse(**analysis_tasks[task_id])


@app.post("/api/v1/analyze/sync", response_model=AnalysisResponse)
async def analyze_stock_sync(request: AnalysisRequest):
    """
    Synchronous trading analysis (blocking)
    
    This endpoint waits for the analysis to complete before returning.
    Use this for testing or when immediate results are needed.
    Warning: May take several minutes to complete.
    """
    task_id = str(uuid.uuid4())
    
    # Create task record
    analysis_tasks[task_id] = {
        "task_id": task_id,
        "status": TaskStatus.PENDING,
        "ticker": request.ticker,
        "date": request.date,
        "created_at": datetime.now().isoformat(),
        "decision": None,
        "error": None,
        "completed_at": None,
        "processing_time_seconds": None
    }
    
    # Run analysis synchronously
    run_analysis(task_id, request)
    
    return AnalysisResponse(**analysis_tasks[task_id])


@app.get("/api/v1/analysis/{task_id}", response_model=AnalysisResponse)
async def get_analysis_result(task_id: str):
    """Get analysis result by task ID"""
    if task_id not in analysis_tasks:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found"
        )
    
    return AnalysisResponse(**analysis_tasks[task_id])


@app.get("/api/v1/tasks")
async def list_tasks(limit: int = 10):
    """List recent analysis tasks"""
    tasks = list(analysis_tasks.values())[-limit:]
    return {
        "tasks": tasks,
        "total": len(tasks)
    }


@app.delete("/api/v1/analysis/{task_id}")
async def delete_task(task_id: str):
    """Delete an analysis task"""
    if task_id not in analysis_tasks:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found"
        )
    
    del analysis_tasks[task_id]
    return {"message": f"Task {task_id} deleted"}


@app.get("/api/v1/config", response_model=Dict[str, Any])
async def get_default_config():
    """Get default TradingAgents configuration"""
    return {
        "llm_config": {
            "deep_think_llm": DEFAULT_CONFIG["deep_think_llm"],
            "quick_think_llm": DEFAULT_CONFIG["quick_think_llm"],
            "max_debate_rounds": DEFAULT_CONFIG["max_debate_rounds"],
            "max_risk_discuss_rounds": DEFAULT_CONFIG["max_risk_discuss_rounds"]
        },
        "data_vendors": DEFAULT_CONFIG["data_vendors"]
    }


# ======================== Run Server ========================

if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("TRADING_SERVICE_PORT", "8001"))
    
    logger.info(f"Starting TradingAgents microservice on port {port}")
    
    uvicorn.run(
        "trading_service:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info"
    )
