This branch focuses on agent layer optimization and UI transparency 

## Problems
- Limited transparency
  - Multi-stage interactions, ambiguous reasoning, inconsistent agent opinions
- High latency
  - Multi-turn sequential execution
- Unstable outcomes
  - “All agents must converge” (debate mechanism) is unrealistic


## Multi-Agent Layer 

### Key Improvements
- Asynchronous Analyst Execution
  -  Exploit I/O-boundedness of external API calls (e.g., market data/news endpoints) using async concurrency to overlap network latency and improve throughput
  -  Note: this primarily provides concurrency, not CPU parallelism; due to CPython’s GIL, CPU-bound workloads still require multiprocessing or native/GPU kernels for true parallel speedups
- Richer Set of Analyst Agents
  - Valulation Agent for Intrinstic Value Estimation 
- Enhanced Prompt Engineering
  - CoF + Self-Reflective  
- Streamlined, CFA-Consistent Investment Workflow
- Adoption of a Quantitative and Factor-Based Scoring

### New Architecture (CFA-Consistent)
<img width="818" height="442" alt="Screenshot 2025-12-14 at 1 20 13 AM" src="https://github.com/user-attachments/assets/5d68852b-6fd2-47f2-92db-98a829efe4b9" />

### Latency Reduction 
- Latency gets reduced from 3-min to 1-min, 70% total reduction (measured end-to-end)
  - 20% from asynchronous I/O concurrency of analyst agent execution 
  - 50% from agent layer redesign

### Quantitative and Factor-Based Scoring
<img width="818" height="442" alt="Screenshot 2025-12-14 at 1 38 16 AM" src="https://github.com/user-attachments/assets/8c3f630a-be4b-4000-a43f-9a9bffefc69b" />

## UI Transparency

- Real Time Status Tracking
- Detailed Breakdown of Factors and Risks 

<img width="818" height="442" alt="Screenshot 2025-12-14 at 1 35 19 AM" src="https://github.com/user-attachments/assets/322eade8-520b-41b6-808c-32eb2799d9ed" />
<img width="818" height="442" alt="Screenshot 2025-12-14 at 1 35 43 AM" src="https://github.com/user-attachments/assets/d70d76fe-61a3-4b3b-9e69-a14cba6b2978" />
