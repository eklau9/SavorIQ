---
pdf_options:
  margin:
    top: 6mm
    right: 16mm
    bottom: 6mm
    left: 16mm
---
<style>
body { 
    font-family: 'Arial', sans-serif; 
    font-size: 9.5pt; 
    line-height: 1.25; 
    color: #000; 
    padding: 0; 
    margin: 0; 
    box-sizing: border-box !important;
}
.markdown-body { 
    font-family: 'Arial', sans-serif; 
    font-size: 9.5pt; 
    line-height: 1.25; 
    color: #000; 
    box-sizing: border-box !important;
    padding: 0 4px !important;
    margin: 0 !important;
}
h1 { 
    font-size: 20pt; 
    text-align: center; 
    margin-bottom: 0px; 
    border-bottom: none !important; 
    padding-bottom: 0; 
    font-weight: bold; 
}
.contact { 
    text-align: center; 
    font-size: 9.5pt; 
    margin-bottom: 8px; 
}
.contact a { 
    color: #000; 
    text-decoration: none; 
}
h2 { 
    font-size: 11pt; 
    border-bottom: 1px solid #000 !important; 
    margin-top: 10px; 
    margin-bottom: 4px; 
    padding-bottom: 1px; 
    text-transform: uppercase; 
    font-weight: bold; 
    color: #000; 
}
.job-header { 
    display: flex; 
    justify-content: space-between; 
    font-weight: bold; 
    font-size: 10pt; 
    margin-bottom: 0px; 
}
.job-meta { 
    display: flex; 
    justify-content: space-between; 
    font-style: italic; 
    font-size: 10pt; 
    margin-bottom: 2px; 
    padding-right: 2px;
}
ul { 
    margin-top: 2px; 
    margin-bottom: 6px; 
    padding-left: 16px; 
}
li { 
    margin-bottom: 1px; 
    font-size: 9.5pt; 
}
.skills-line { 
    font-size: 9.5pt; 
    margin-bottom: 1px; 
}
</style>

# Edward Lau
<div class="contact">
415-699-9139 | eklau90@gmail.com | linkedin.com/in/eklau
</div>

## Skills
<div class="skills-line"><strong>Languages:</strong> Python, Java, Shell/Bash, C++, C#</div>
<div class="skills-line"><strong>AI/ML & LLMOps:</strong> Google Gemini API, LLM Prompt Engineering, Sentiment Analysis Pipelines, Batch Evaluation</div>
<div class="skills-line"><strong>CI/CD:</strong> Jenkins, Spinnaker, GitLab CI, GitHub Actions</div>
<div class="skills-line"><strong>Containers & Orchestration:</strong> Docker, Kubernetes, Helm</div>
<div class="skills-line"><strong>Infrastructure as Code:</strong> Terraform, Chef</div>
<div class="skills-line"><strong>Cloud Platforms:</strong> AWS, GCP, Azure</div>
<div class="skills-line"><strong>Monitoring & Observability:</strong> Prometheus, Grafana, Datadog, CloudWatch</div>
<div class="skills-line"><strong>Databases:</strong> PostgreSQL (Supabase), SQLite, SQLAlchemy (async)</div>

## Experience

<div class="job-header"><span>SavorIQ — AI-Powered Restaurant Intelligence Platform</span><span>San Francisco, CA</span></div>
<div class="job-meta"><span>Founder & Engineer</span><span>Sep 2024 – Present</span></div>
<ul>
<li>Founded and launched a B2B SaaS intelligence platform that aggregates cross-platform restaurant reviews, leveraging LLMs to extract actionable sentiment insights for hospitality operators.</li>
<li>Designed and built the core AI evaluation pipeline using the Google Gemini API to process 200+ reviews concurrently, driving the analytics dashboard with categorized sentiment scores.</li>
<li>Developed production-grade async backend services using FastAPI and SQLAlchemy, delivering real-time sync progress to an interactive React/Expo frontend via Server-Sent Events (SSE).</li>
<li>Engineered a smart delta sync engine that calculates precise review differentials, reducing external API credit consumption by over 80% and optimizing SaaS operational costs.</li>
<li>Architected highly resilient infrastructure, including self-healing web scrapers and AI quota management systems (tracking RPM/RPD via sliding windows) to protect against upstream rate-limit outages.</li>
</ul>

<div class="job-header"><span>Chartboost, Inc.</span><span>San Francisco, CA</span></div>
<div class="job-meta"><span>DevOps Engineer</span><span>Jan 2021 – Aug 2023</span></div>
<ul>
<li>Built proactive incident detection systems in Python for SSL expirations, DNS health, and real-time Slack alerting, reducing mean time to detect (MTTD) for infrastructure issues.</li>
<li>Optimized Kubernetes resource allocations across multi-cloud clusters (AWS, GCP), improving service reliability while reducing unnecessary cloud spend.</li>
<li>Integrated Datadog observability by piping Google Cloud Function logs into real-time dashboards with custom metrics and intelligent retry reporting.</li>
<li>Standardized AKS and GKE deployments using Helm chart templates, ConfigMaps, and Spinnaker ingress configurations.</li>
<li>Migrated CI/CD workflows from AWS to GCP via JJB templates, automated GitHub Actions, and securely managed secrets with HashiCorp Vault.</li>
</ul>

<div class="job-header"><span>Macy's, Inc.</span><span>San Francisco, CA</span></div>
<div class="job-meta"><span>DevOps Engineer</span><span>Feb 2017 – Feb 2020</span></div>
<ul>
<li>Designed and managed scalable Docker and Kubernetes environments integrated with Jenkins CI/CD pipelines for microservices architecture.</li>
<li>Automated bi-weekly release branching across enterprise projects using Jenkins pipelines and Cloud Functions, accelerating delivery cycles.</li>
<li>Orchestrated automated workflows integrating Google Cloud Functions, Cloud Scheduler, and Pub/Sub.</li>
<li>Built SRE observability dashboards via Prometheus and Grafana, providing real-time visibility into service health and resource utilization.</li>
<li>Formatted and managed continuous artifact versioning and deployment tracking workflows using JFrog Artifactory.</li>
</ul>

## Education

<div class="job-header"><span>University of California, San Diego</span><span>San Diego, CA</span></div>
<div class="job-meta"><span>B.S. Computer Science</span><span>Sep 2013 – Dec 2016</span></div>

## Certifications
<ul style="margin-bottom: 0px">
<li>Certified Kubernetes Application Developer (CKAD)</li>
</ul>
