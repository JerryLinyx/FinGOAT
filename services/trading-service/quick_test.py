#!/usr/bin/env python3
"""
Quick test script for TradingAgents microservice
Tests basic endpoints without running full analysis
"""

import requests
import json

BASE_URL = "http://localhost:8001"

def test_health():
    """Test health endpoint"""
    print("Testing /health endpoint...")
    response = requests.get(f"{BASE_URL}/health")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    assert response.status_code == 200
    print("✅ Health check passed\n")

def test_config():
    """Test config endpoint"""
    print("Testing /api/v1/config endpoint...")
    response = requests.get(f"{BASE_URL}/api/v1/config")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    assert response.status_code == 200
    print("✅ Config endpoint passed\n")

def test_submit_analysis():
    """Test submitting an analysis (async)"""
    print("Testing POST /api/v1/analyze endpoint...")
    payload = {
        "ticker": "NVDA",
        "date": "2024-05-10"
    }
    response = requests.post(f"{BASE_URL}/api/v1/analyze", json=payload)
    print(f"Status: {response.status_code}")
    result = response.json()
    print(f"Response: {json.dumps(result, indent=2)}")
    assert response.status_code == 202
    print(f"✅ Analysis submitted with task_id: {result['task_id']}\n")
    return result['task_id']

def test_get_task_status(task_id):
    """Test getting task status"""
    print(f"Testing GET /api/v1/analysis/{task_id} endpoint...")
    response = requests.get(f"{BASE_URL}/api/v1/analysis/{task_id}")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    assert response.status_code == 200
    print("✅ Task status retrieved\n")

def test_list_tasks():
    """Test listing tasks"""
    print("Testing GET /api/v1/tasks endpoint...")
    response = requests.get(f"{BASE_URL}/api/v1/tasks?limit=5")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    assert response.status_code == 200
    print("✅ Task list retrieved\n")

if __name__ == "__main__":
    print("="*60)
    print("  TradingAgents Microservice - Quick Test")
    print("="*60)
    print()
    
    try:
        # Test 1: Health check
        test_health()
        
        # Test 2: Config
        test_config()
        
        # Test 3: Submit analysis
        task_id = test_submit_analysis()
        
        # Test 4: Check task status
        test_get_task_status(task_id)
        
        # Test 5: List tasks
        test_list_tasks()
        
        print("="*60)
        print("  ✅ All basic tests passed!")
        print("="*60)
        print()
        print("📝 Note: The analysis task is running in background.")
        print(f"   Check status with: curl http://localhost:8001/api/v1/analysis/{task_id}")
        print()
        print("⚠️  Full analysis will take 2-5 minutes to complete.")
        
    except requests.exceptions.ConnectionError:
        print("\n❌ Error: Cannot connect to service")
        print("   Make sure the service is running: cd services/trading-service && python trading_service.py")
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
