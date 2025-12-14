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
<img width="674" height="276" alt="Screenshot 2025-12-14 at 1 20 13 AM" src="https://github.com/user-attachments/assets/5d68852b-6fd2-47f2-92db-98a829efe4b9" />

### Latency Reduction 
- 70% total reduction (measured end-to-end)
- 20% from asynchronous I/O concurrency of analyst agency execution 
- 50% from agent layer redesign
<img width="323" height="230" alt="Screenshot 2025-12-14 at 1 29 03 AM" src="https://github.com/user-attachments/assets/906bd2a9-83e1-41e1-8b27-ae0826bd102c" />

###  Quantitative Scoring via MCP Calling
- PM Engine 
<img width="392" height="383" alt="Screenshot 2025-12-14 at 1 33 50 AM" src="https://github.com/user-attachments/assets/198c534c-58aa-4c1d-875f-e1435e94e039" />

- Risk Manager
<img width="428" height="39" alt="Screenshot 2025-12-14 at 1 34 12 AM" src="https://github.com/user-attachments/assets/34fc0522-6905-4c48-abeb-63440c4c73a9" />

## UI Transparency

- Real Time Status Tracking
- Detailed Breakdown of factors and risks 

<img width="818" height="442" alt="Screenshot 2025-12-14 at 1 35 19 AM" src="https://github.com/user-attachments/assets/322eade8-520b-41b6-808c-32eb2799d9ed" />
<img width="824" height="438" alt="Screenshot 2025-12-14 at 1 35 43 AM" src="https://github.com/user-attachments/assets/d70d76fe-61a3-4b3b-9e69-a14cba6b2978" />
