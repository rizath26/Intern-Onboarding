# Trade-off — Hosting options for GreenChit

Feeds **ADR-0002**. The full write-up, with decision rationale and design-review feedback, is in
`mohamed-rizath-day4-trade-offs-and-review.md` at the root of this repository.

Scores are 1 (poor) to 5 (excellent) **for GreenChit's situation**, not in general.
Weights: ×3 = decision driver, ×2 = important, ×1 = nice to have at today's scale.

| Quality attribute | Weight | Option A: App Service monolith | Option B: Container Apps split | Why (A) | Why (B) |
|---|:-:|:-:|:-:|---|---|
| Time-to-first-deploy **(decision driver)** | ×3 | 5 | 2 | One App Service with a staging slot. Deployed from GitHub Actions using .NET skills the team already has. Nothing new to learn before the first release. | Needs Dockerfiles, Azure Container Registry, a Container Apps environment, Bicep/Terraform and an image pipeline. These are new skills for this team, so weeks rather than days. |
| Cost (low spend) | ×2 | 5 | 2 | Two small P0v3 instances host the API, the SPA and the background workers together. A single predictable monthly line. | Scale-to-zero would be cheap, but it breaks the 08:00 p95 target, so each app needs at least one replica. Add the registry and extra log ingestion and it costs more for the same load. |
| Operability for 10-person team **(decision driver)** | ×3 | 4 | 3 | One app, one log stream, and the platform patches the OS. Loses a point because the background workers share the request process (ADR-0002 uncomfortable consequence). | Failures are isolated per service, which is a real plus. But revisions, replicas, image versions and environment networking are more moving parts for a team with little container experience. |
| Independent deploy | ×1 | 1 | 5 | Any change, even a notification template fix, redeploys everything. | Each container app has its own revisions and can be rolled out or rolled back on its own. |
| Future scaling | ×1 | 2 | 5 | Can only scale the whole app out. Fine at under 1 request per second, but a busy worker can't scale on its own. | Each service scales separately. The worker can scale on Service Bus queue length (KEDA). |
| Authn/authz consistency | ×2 | 4 | 3 | One ASP.NET Core auth pipeline and one access-policy class enforce every rule in one process. Loses a point because background workers act as the app identity, outside any user context. | Each service must validate tokens and apply the same policies. Service-to-service calls need their own managed-identity setup, and there's a risk the rules drift between services. |
| **Total (unweighted)** | | **21** | **20** | Nearly a tie. The raw total doesn't decide anything. | |
| **Total (weighted)** | | **48** / 60 | **35** / 60 | Weighted by what the business says matters most (see Setup). | |

**Reading the table:** scoring is an argument tool, not a calculator. The point is that every cell
above has a reason someone could disagree with.
