# LearnLanka — Ambiguity Hunt Log

**Author:** Mohamed Rizath  |  **Date:** 20 October 2026

## Brief reference

Source text, pasted verbatim. Ambiguous phrases are in **bold**.

> LearnLanka is a Colombo-based startup that connects O/L and A/L students with **vetted tutors** for one-to-one online sessions. They have a one-paragraph brief, no diagrams, and **three contradictory expectations from the founders**. Your job is to turn the brief into a clear requirements document, a C4 Context diagram, a user story set, and a list of clarification questions the team should ask before any code is written.

**Functional Requirements**
- Students must be able to search for tutors by subject, grade, language (Sinhala, Tamil, English), and **price band**
- Students must be able to book a **1-hour session** with a tutor and **pay via card or eZ Cash**
- Tutors must be able to publish availability slots, **accept or decline bookings**, and **cancel with at least 12 hours notice**
- The platform must charge a **15% commission on every completed session** and **pay tutors weekly via bank transfer**
- Both parties must be able to **rate each other (1-5 stars) and leave a one-line comment** after the session

**Non-Functional Requirements**
- Tutor search results: returned in **under 800 ms at the 95th percentile from a Sri Lankan ISP**
- Availability: **99.5% monthly uptime, measured against the booking endpoint**
- Concurrent sessions: support **200 simultaneous video sessions in the first 6 months**
- Privacy: comply with Sri Lanka Personal Data Protection Act 2022 — **consent capture, deletion request flow**
- Payment data: never stored on LearnLanka servers — must use a PCI-DSS compliant gateway

**Technical Constraints**
- **Mobile-first product — at least 80% of usage is expected on Android devices**
- The team has Azure credits; preferred cloud is Azure (App Service, Azure SQL, Blob Storage)
- **Video calling will be outsourced to a third-party (Daily.co or 100ms)** — not built in-house
- Payment gateway will be PayHere; bank payouts will be Sampath Vishwa
- **All UI strings must support Sinhala, Tamil, and English from launch**

## Findings

| # | Quote | Why ambiguous | Clarification question | Priority |
|---|-------|---------------|------------------------|----------|
| 1 | "three contradictory expectations from the founders" | The brief says the founders disagree but never says about what. Any requirement I write could be one that a founder rejects, and I cannot tell which of the rest are affected. | What are the three expectations that conflict, which founder holds each, and who has the final say when they disagree? | H |
| 2 | "connects O/L and A/L students with vetted tutors" | "Vetted" is a promise to students, but the brief gives no vetting criteria, no owner and no process. It also defines no work for the Ops Admin, even though that role exists. | Who vets tutors, using which criteria (qualifications, ID check, interview, trial lesson), and is vetting done inside the platform or outside it? | H |
| 3 | "price band" | "Band" is not defined: fixed ranges set by LearnLanka or a free minimum–maximum slider? The brief also does not say who sets a tutor's hourly rate. | Are price bands fixed LKR ranges (for example, under 1,500 / 1,500–3,000 / over 3,000), and does each tutor set their own hourly rate or does LearnLanka set it? | M |
| 4 | "book a 1-hour session with a tutor" | It is unclear whether 1 hour is the only possible length, and whether a student may book several slots back to back or repeat a booking every week. | Is 1 hour the only session length for launch, and may a student book several consecutive or recurring sessions in one go? | M |
| 5 | "pay via card or eZ Cash" | The brief does not say *when* the student is charged: at the moment of booking, or only after the tutor accepts. The brief also says tutors "accept or decline", so a student could be charged for a session that never happens. This decides how the payment and refund flow works. | Is the student charged when they request the booking or when the tutor accepts, and does PayHere support eZ Cash for our merchant account in the way we need (hold then confirm, or charge then refund)? | H |
| 6 | "accept or decline bookings" | There is no time limit for the tutor to respond and no rule for what happens when the tutor says nothing. The student's slot and money could be stuck indefinitely. | How long does a tutor have to answer a request, and what happens (auto-expire? auto-accept? reminder?) when they do not answer? | M |
| 7 | "cancel with at least 12 hours notice" | It says "tutors" cancel, but says nothing about students cancelling. It also does not say what happens when someone cancels inside 12 hours, or whether the student is refunded. | May students cancel too and with what refund rule, and what is the consequence (block, penalty, contact Ops) if a tutor must cancel with less than 12 hours' notice? | H |
| 8 | "15% commission on every completed session" | "Completed" is not defined (both joined? minimum minutes? end time reached?). It is also unclear whether the 15% is taken from the full price, whether tax applies, and who pays the payment-gateway fee. | What makes a session "completed", is the 15% calculated on the price the student paid including any gateway fee or tax, and what happens to commission when a session is refunded or disputed? | H |
| 9 | "pay tutors weekly via bank transfer" | The weekday, the cut-off time and the minimum amount are not given. Sampath Vishwa is named, but not how LearnLanka talks to it (API, file upload, manual) and what happens to tutors with other banks. | On which weekday is payout run, is there a minimum amount or a waiting period for disputes, how are payout instructions sent to Sampath Vishwa, and how will tutors with accounts at other banks be paid? | H |
| 10 | "rate each other (1-5 stars) and leave a one-line comment" | It is unclear who can see each rating, whether comments are checked before they appear, how long after a session a rating is allowed, and what "one-line" means in characters. | Who sees a student's rating of a tutor and a tutor's rating of a student, who moderates comments, what is the maximum comment length, and until when after the session can a rating be left? | M |
| 11 | "under 800 ms at the 95th percentile from a Sri Lankan ISP" | The measuring point is not clear: a real phone on a mobile network, a test server in Sri Lanka, or timing inside the server? These give very different numbers. It also does not say under what load or how many results. | Is the 800 ms measured end to end on a user's device, from a test probe on a named Sri Lankan ISP, or only on the server, and for how many results per page and at what load? | M |
| 12 | "99.5% monthly uptime, measured against the booking endpoint" | It does not say what counts as "up" (any non-error response? within a time limit?), whether planned maintenance is excluded, or whether outages at PayHere or the video provider count against LearnLanka. | What counts as a successful booking-endpoint request, is planned maintenance excluded, and do outages of third parties (PayHere, video provider) count against the 99.5%? | M |
| 13 | "support 200 simultaneous video sessions in the first 6 months" | A session probably has two participants, so 200 sessions is 400 video streams, but this is not stated. The brief also says nothing about what the target is after month 6 or about how many other users will be browsing at the same time. | Is the 200 a count of sessions (two participants each) or of participants, what is the target after the first 6 months, and how many non-video users must the platform serve at the same time? | M |
| 14 | "consent capture, deletion request flow" | O/L students are likely to be under 18 and cannot always give valid consent themselves. The brief does not say whether a parent or guardian must create the account, give consent or pay. | Do students under 18 sign up alone, or must a parent or guardian create the account, give the PDPA consent and pay? | H |
| 15 | "deletion request flow" | The brief does not say how long LearnLanka has to complete a deletion or what must be kept anyway (for example payment and commission records). The preferred cloud is Azure but the data region is not stated either. | What is the deadline for completing a deletion request, which records must be kept despite a request, and must the data stay in a particular country or Azure region? | M |
| 16 | "Mobile-first product — at least 80% of usage is expected on Android devices" | "Mobile-first" does not say whether this is a native app, a web app that behaves like an app, or a responsive website. It does not say whether iOS and desktop are supported for the other 20%, or what the Ops Admin uses. | Is the product a native Android app, a progressive web app or a responsive website, which minimum Android version must work, and are iOS and desktop browsers in scope for launch? | H |
| 17 | "Video calling will be outsourced to a third-party (Daily.co or 100ms)" | The provider has not been chosen, and the choice affects cost, concurrency limits, recording and where data is processed. The brief does not say whether the sessions may be recorded. | Who decides between Daily.co and 100ms and by when, and is recording of sessions required, forbidden or optional? | M |
| 18 | "All UI strings must support Sinhala, Tamil, and English from launch" | It covers "UI strings", but not content written by users (tutor bios, comments), nor notifications, SMS and emails. It is not clear who produces and checks the translations. | Do the three languages also apply to notifications, SMS, emails and tutor-written content, and who will provide and approve the Sinhala and Tamil translations? | M |

## Results Summary

| Metric | Target | Achieved |
|--------|--------|----------|
| Items found | 10+ | **18** |
| High-priority items | 3+ | **8** (#1, #2, #5, #7, #8, #9, #14, #16) |
| Items convertible to test cases | 5+ | **14** (#3, #4, #5, #6, #7, #8, #9, #10, #11, #12, #13, #14, #15, #18) |

Items not convertible to a test case yet (need a business decision first): #1, #2, #16, #17.

## Top 3 questions to ask the founders

1. **Which three expectations contradict each other, who holds each one, and who decides when they conflict?** (#1) Until this is answered, anything else we build may be thrown away.
2. **When is the student charged, and what refund do they receive if the tutor declines, does not answer, or cancels, or if the student cancels more or less than 12 hours before the start?** (#5, #6, #7) This decides the booking and payment flow and the commission and payout figures.
3. **Do students under 18 sign up alone, or must a parent or guardian create the account, give consent and pay?** (#14) This decides sign-up, consent capture and who is the paying customer under the Personal Data Protection Act.

## Reflection

**What kind of ambiguity tripped you up most?**
Words that sound precise but depend on a definition nobody wrote down: "completed", "booking", "cancel" (by whom?) and "bands". The money requirements were the worst, because each one hides several undefined cases (decline, no answer, refund, failed transfer). The second kind was measurement: "800 ms from a Sri Lankan ISP" sounds exact, but a number measured on the server and a number measured on a student's phone are not the same number.

**Which question is most likely to change the architecture if answered?**
Question 2 (when the student is charged). If the student is only finally charged after the tutor accepts, the booking needs several states (requested, accepted, declined, expired, cancelled, completed), the payment must be held or refunded, and the payout ledger has to follow every state. We also have to find out whether PayHere can support that flow. If the student is charged immediately, the design is simpler, but refunds become a daily case. The mobile-delivery question (#16) is a close second, because a native app, a PWA and a responsive website are built in different ways.

**Why is ambiguity expensive?**
A wrong guess is only discovered late: after the booking flow, the database and the tests have been built on it. Then the developer rebuilds, the tester rewrites the tests, and in a payment system the customer or tutor may already have lost money. Asking one question before coding costs minutes; fixing a wrong assumption after release costs weeks and trust.
