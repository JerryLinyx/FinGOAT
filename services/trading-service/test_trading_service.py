"""
Test script for TradingAgents FastAPI Microservice

This script demonstrates how to interact with the trading service API.
"""

import requests
import time
import json
from typing import Dict, Any


BASE_URL = "http://localhost:8001"


def print_json(data: Dict[str, Any], title: str = ""):
    """Pretty print JSON data"""
    if title:
        print(f"\n{'='*60}")
        print(f"  {title}")
        print('='*60)
    print(json.dumps(data, indent=2, ensure_ascii=False))


def test_health_check():
    """Test health check endpoint"""
    print_json({}, "Testing Health Check")
    
    response = requests.get(f"{BASE_URL}/health")
    print(f"Status Code: {response.status_code}")
    print_json(response.json())
    
    return response.status_code == 200


def test_get_default_config():
    """Test getting default configuration"""
    print_json({}, "Getting Default Configuration")
    
    response = requests.get(f"{BASE_URL}/api/v1/config")
    print(f"Status Code: {response.status_code}")
    print_json(response.json())
    
    return response.status_code == 200


def test_async_analysis(ticker: str = "NVDA", date: str = "2024-05-10"):
    """Test asynchronous analysis endpoint"""
    print_json({}, f"Testing Async Analysis: {ticker} on {date}")
    
    # Submit analysis request
    payload = {
        "ticker": ticker,
        "date": date,
        "llm_config": {
            "deep_think_llm": "gpt-4o-mini",
            "quick_think_llm": "gpt-4o-mini",
            "max_debate_rounds": 1
        }
    }
    
    print("Submitting analysis request...")
    print_json(payload, "Request Payload")
    
    response = requests.post(f"{BASE_URL}/api/v1/analyze", json=payload)
    print(f"Status Code: {response.status_code}")
    
    if response.status_code != 202:
        print(f"Error: {response.json()}")
        return None
    
    result = response.json()
    print_json(result, "Initial Response")
    
    task_id = result["task_id"]
    print(f"\n✓ Task created with ID: {task_id}")
    
    # Poll for results
    print("\nPolling for results (this may take a few minutes)...")
    max_attempts = 60  # 5 minutes with 5 second intervals
    
    for attempt in range(max_attempts):
        time.sleep(5)
        
        response = requests.get(f"{BASE_URL}/api/v1/analysis/{task_id}")
        result = response.json()
        
        status = result["status"]
        print(f"  [{attempt+1}/{max_attempts}] Status: {status}")
        
        if status == "completed":
            print_json(result, "✓ Analysis Completed")
            return result
        elif status == "failed":
            print_json(result, "✗ Analysis Failed")
            return None
    
    print("Timeout waiting for analysis to complete")
    return None


def test_sync_analysis(ticker: str = "AAPL", date: str = "2024-05-10"):
    """Test synchronous analysis endpoint (use with caution)"""
    print_json({}, f"Testing Sync Analysis: {ticker} on {date}")
    print("⚠️  Warning: This will block until analysis completes (2-5 minutes)")
    
    payload = {
        "ticker": ticker,
        "date": date,
        "llm_config": {
            "deep_think_llm": "gpt-4o-mini",
            "quick_think_llm": "gpt-4o-mini",
            "max_debate_rounds": 1
        }
    }
    
    print("Submitting synchronous analysis request...")
    print_json(payload, "Request Payload")
    
    try:
        response = requests.post(
            f"{BASE_URL}/api/v1/analyze/sync",
            json=payload,
            timeout=600  # 10 minute timeout
        )
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print_json(result, "✓ Analysis Completed")
            return result
        else:
            print(f"Error: {response.json()}")
            return None
            
    except requests.exceptions.Timeout:
        print("Request timed out")
        return None


def test_list_tasks():
    """Test listing recent tasks"""
    print_json({}, "Listing Recent Tasks")
    
    response = requests.get(f"{BASE_URL}/api/v1/tasks?limit=5")
    print(f"Status Code: {response.status_code}")
    print_json(response.json())
    
    return response.status_code == 200


def main():
    """Run all tests"""
    print("\n" + "="*60)
    print("  TradingAgents Microservice Test Suite")
    print("="*60)
    print("\nMake sure the service is running: cd services/trading-service && python trading_service.py")
    
    try:
        # Test 1: Health check
        if not test_health_check():
            print("\n✗ Health check failed. Is the service running?")
            return
        
        # Test 2: Get configuration
        test_get_default_config()
        
        # Test 3: List tasks (may be empty initially)
        test_list_tasks()
        
        # Test 4: Async analysis
        print("\n" + "="*60)
        print("Starting async analysis test...")
        print("="*60)
        
        # Uncomment to test async analysis (takes 2-5 minutes)
        # result = test_async_analysis("NVDA", "2024-05-10")
        # if result:
        #     print("\n✓ Async analysis test passed")
        # else:
        #     print("\n✗ Async analysis test failed")
        
        print("\n💡 To test async analysis, uncomment the test_async_analysis() call in main()")
        
        # Test 5: Sync analysis (optional, takes longer)
        # print("\n" + "="*60)
        # print("Starting sync analysis test...")
        # print("="*60)
        # result = test_sync_analysis("AAPL", "2024-05-10")
        
        print("\n" + "="*60)
        print("  Test Suite Completed")
        print("="*60)
        
    except requests.exceptions.ConnectionError:
        print("\n✗ Cannot connect to service. Make sure it's running on http://localhost:8001")
    except Exception as e:
        print(f"\n✗ Error during testing: {str(e)}")


if __name__ == "__main__":
    main()
