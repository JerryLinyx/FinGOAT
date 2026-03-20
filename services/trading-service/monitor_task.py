#!/usr/bin/env python3
"""
Monitor TradingAgents analysis task progress
"""

import requests
import time
import json
import sys
from datetime import datetime

BASE_URL = "http://localhost:8001"

def check_task_status(task_id):
    """Check and return task status"""
    try:
        response = requests.get(f"{BASE_URL}/api/v1/analysis/{task_id}")
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Error: {response.status_code}")
            return None
    except Exception as e:
        print(f"Error checking status: {e}")
        return None

def display_result(result):
    """Display analysis result in readable format"""
    print("\n" + "="*70)
    print("  📊 ANALYSIS COMPLETE")
    print("="*70)
    
    print(f"\n🎯 Stock: {result['ticker']}")
    print(f"📅 Date: {result['date']}")
    print(f"⏱️  Processing Time: {result.get('processing_time_seconds', 0):.1f} seconds")
    
    if result.get('decision'):
        decision = result['decision']
        print(f"\n💡 Decision: {decision.get('action', 'N/A')}")
        print(f"📈 Confidence: {decision.get('confidence', 0):.2%}")
        
        if decision.get('position_size'):
            print(f"📊 Position Size: {decision['position_size']}")
        
        if decision.get('raw_decision'):
            print(f"\n📝 Full Decision Details:")
            print(json.dumps(decision['raw_decision'], indent=2, ensure_ascii=False))
    
    print("\n" + "="*70)

def monitor_task(task_id, max_wait_minutes=10):
    """Monitor task until completion or timeout"""
    print("="*70)
    print(f"  🔍 Monitoring Analysis Task")
    print("="*70)
    print(f"\nTask ID: {task_id}")
    print(f"Max wait time: {max_wait_minutes} minutes")
    print(f"Started at: {datetime.now().strftime('%H:%M:%S')}")
    print("\nChecking status every 10 seconds...\n")
    
    start_time = time.time()
    max_wait_seconds = max_wait_minutes * 60
    check_count = 0
    
    while True:
        elapsed = time.time() - start_time
        
        if elapsed > max_wait_seconds:
            print(f"\n⏰ Timeout after {max_wait_minutes} minutes")
            break
        
        check_count += 1
        result = check_task_status(task_id)
        
        if result is None:
            print("❌ Failed to get status, retrying...")
            time.sleep(10)
            continue
        
        status = result['status']
        elapsed_str = f"{int(elapsed)}s"
        
        if status == "pending":
            print(f"[{check_count:3d}] {elapsed_str:>5s} | ⏳ Pending...")
        elif status == "processing":
            print(f"[{check_count:3d}] {elapsed_str:>5s} | 🔄 Processing...")
        elif status == "completed":
            print(f"[{check_count:3d}] {elapsed_str:>5s} | ✅ Completed!")
            display_result(result)
            return result
        elif status == "failed":
            print(f"[{check_count:3d}] {elapsed_str:>5s} | ❌ Failed!")
            print(f"\nError: {result.get('error', 'Unknown error')}")
            return result
        
        time.sleep(10)
    
    print("\n⚠️  Task still running. Check manually with:")
    print(f"   curl http://localhost:8001/api/v1/analysis/{task_id}")
    return None

if __name__ == "__main__":
    if len(sys.argv) > 1:
        task_id = sys.argv[1]
    else:
        # Get latest task
        try:
            response = requests.get(f"{BASE_URL}/api/v1/tasks?limit=1")
            tasks = response.json().get('tasks', [])
            if tasks:
                task_id = tasks[0]['task_id']
                print(f"Using latest task: {task_id}\n")
            else:
                print("No tasks found. Please provide task_id as argument:")
                print("   python monitor_task.py <task_id>")
                sys.exit(1)
        except Exception as e:
            print(f"Error getting latest task: {e}")
            sys.exit(1)
    
    try:
        monitor_task(task_id, max_wait_minutes=10)
    except KeyboardInterrupt:
        print("\n\n⏸️  Monitoring interrupted by user")
        print(f"   Check status with: curl http://localhost:8001/api/v1/analysis/{task_id}")
