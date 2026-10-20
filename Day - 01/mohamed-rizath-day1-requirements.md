# LearnLanka — Requirements Document

**Author:** Mohamed Rizath  |  **Version:** 0.1  |  **Date:** 20 October 2026
**Source:** LearnLanka one-paragraph brief + Business Requirements (Day 1 challenge)

> Tags used in this document: **[Brief]** = stated in the brief. **[Assumed]** = the brief is silent; I made an assumption (see Section 5). Every assumption is also raised as a question in `mohamed-rizath-day1-ambiguity-log.md`.

---

## 1. Problem Statement

O/L and A/L students in Sri Lanka need help in specific subjects, but finding a tutor they can trust is hard: they must match subject, grade, teaching language (Sinhala, Tamil or English), price and free time, and they usually have no reliable way to check a tutor's quality before paying. Good tutors, in turn, struggle to reach students beyond their own area, to manage their available hours, and to get paid predictably. LearnLanka should be a mobile-first marketplace where a student can find a vetted tutor, book a one-hour online session, pay safely, and rate the experience, while a tutor controls their own availability and is paid weekly, and LearnLanka earns a 15% commission on every completed session. Today the founders have only a one-paragraph brief and conflicting expectations, so the first job is to turn that brief into clear, testable requirements before any code is written.

---

## 2. Personas

> The personas are fictional examples I created to make the goals concrete. They are not data from LearnLanka.

### 2.1 Student — "Nimali", 16, O/L candidate (Kandy)

| | |
|---|---|
| **Context** | Studies Mathematics and Science for the O/L exam; uses an Android phone on mobile data; her parents help with payment. |
| **Goals** | Find a tutor who teaches her subject and grade **in Tamil** within her family's budget; book a time after school; pay without needing a bank card (eZ Cash); know the session will really happen. |
| **Frustrations** | Cannot tell whether a tutor is good before paying; slow apps on mobile data; apps that are English-only; tutors cancelling at short notice; unclear refunds. |

### 2.2 Tutor — "Kasun", 27, A/L Combined Mathematics tutor (part-time)

| | |
|---|---|
| **Context** | Graduate with a day job; teaches in the evenings and at weekends; wants students from outside his town. |
| **Goals** | Publish only the hours he is really free; accept or decline requests; build a reputation through ratings; see exactly how much he earns after commission; be paid every week. |
| **Frustrations** | Double bookings; students who do not turn up; unclear commission; late or irregular payments; no way to cancel fairly when something comes up. |

### 2.3 Operations Admin — "Farhana", 31, LearnLanka operations team

| | |
|---|---|
| **Context** | Keeps the platform running day to day; works from a desktop; is accountable to the founders for money and compliance. |
| **Goals** | Approve only vetted tutors; make sure every weekly payout equals 85% of completed sessions; resolve disputes with evidence; handle data-deletion requests within the legal time. |
| **Frustrations** | Reconciling payments and payouts by hand in spreadsheets; no audit trail of who changed what; unclear refund rules; abusive rating comments she cannot remove. |

---

## 3. Functional Requirements

Each requirement is written as an observable behaviour (the *what*, not the *how*) so that QA can write a test for it.

### 3.1 Student

| ID | Requirement |
|---|---|
| FR-S1 | A Student can search for tutors by **subject, grade, language (Sinhala, Tamil, English) and price band**; when several filters are chosen, every returned tutor matches **all** of them. **[Brief]** |
| FR-S2 | Each search result shows the tutor's name, teaching language(s), hourly rate and average rating. **[Assumed]** |
| FR-S3 | A Student can see a tutor's open availability slots and book a **1-hour** session in one of them. **[Brief]** |
| FR-S4 | A slot that has been booked (or is awaiting the tutor's answer) cannot be booked by another Student. **[Assumed]** |
| FR-S5 | A Student can pay for a booking by **card or eZ Cash**. **[Brief]** |
| FR-S6 | A Student is told when the tutor accepts or declines their booking, and when a request expires without an answer. **[Assumed]** |
| FR-S7 | A Student is not charged (or is refunded in full) when the tutor declines, does not answer in time, or cancels. **[Assumed]** |
| FR-S8 | A Student can cancel a confirmed booking at least 12 hours before its start time and receives a full refund. **[Assumed]** |
| FR-S9 | A Student can join the video session for a confirmed booking at its start time. **[Assumed]** |
| FR-S10 | After a completed session, a Student can rate the tutor **1–5 stars** and leave a **one-line comment**, once per session. **[Brief]** |
| FR-S11 | A Student can record or withdraw consent for use of their personal data and can submit a request to have their personal data deleted. **[Brief — PDPA]** |

### 3.2 Tutor

| ID | Requirement |
|---|---|
| FR-T1 | A Tutor can publish, change and remove 1-hour availability slots; slots that overlap each other are rejected. **[Brief]** |
| FR-T2 | A Tutor can see incoming booking requests and **accept or decline** each one. **[Brief]** |
| FR-T3 | A Tutor can cancel an accepted booking **only if at least 12 hours remain** before its start; a cancellation attempt with less than 12 hours remaining is refused with a reason. **[Brief]** |
| FR-T4 | A Tutor can join the video session for a confirmed booking at its start time. **[Assumed]** |
| FR-T5 | After a completed session, a Tutor can rate the Student **1–5 stars** and leave a **one-line comment**, once per session. **[Brief]** |
| FR-T6 | A Tutor can see, for each completed session, the session price, the 15% commission and the net amount, and the status of each weekly payout. **[Assumed]** |
| FR-T7 | A Tutor is paid **weekly by bank transfer** for sessions completed, net of the 15% commission. **[Brief]** |

### 3.3 Operations Admin

| ID | Requirement |
|---|---|
| FR-O1 | An Ops Admin can approve, reject or suspend a Tutor; only approved Tutors appear in Student search. **[Brief — "vetted tutors"; mechanism Assumed]** |
| FR-O2 | The platform records a **15% commission** on every completed session and shows it per session in a ledger an Ops Admin can view. **[Brief]** |
| FR-O3 | An Ops Admin can review the weekly payout batch (each session, commission, net, total), exclude a line with a recorded reason, approve it, and see which payouts succeeded or failed. **[Assumed]** |
| FR-O4 | An Ops Admin can see open data-deletion requests, complete them and record the completion date. **[Brief — PDPA]** |
| FR-O5 | An Ops Admin can view bookings and payment status for a given Student or Tutor to resolve disputes. **[Assumed]** |
| FR-O6 | An Ops Admin can hide a rating comment that breaks the platform's content rules; the action is logged with the admin's name and the reason. **[Assumed]** |

### 3.4 Cross-cutting

| ID | Requirement |
|---|---|
| FR-X1 | Every screen label, message and notification text is available in **Sinhala, Tamil and English**, and a user can choose their language. **[Brief]** |
| FR-X2 | The platform confirms a user's mobile number before first booking or first slot publication. **[Assumed]** |

---

## 4. Non-Functional Requirements

| Category | Metric | Target | How we'll measure it |
|---|---|---|---|
| Performance **[Brief]** | Tutor search response time, 95th percentile | **< 800 ms** from a Sri Lankan ISP | Synthetic search probes run every 5 min from a Sri Lankan mobile network and a fixed-line ISP, plus server-side request timing; p95 reported daily |
| Availability **[Brief]** | % of booking-endpoint requests answered successfully (non-error response) per calendar month | **≥ 99.5 %** (about 3 h 36 min of allowed downtime in a 30-day month) | Synthetic booking check every minute plus server logs; monthly report |
| Scalability **[Brief]** | Simultaneous active video sessions in the first 6 months | **≥ 200** sessions (400 participants if each is one tutor + one student **[Assumed]**) | Load test before launch; peak concurrent sessions from the video provider's dashboard |
| Privacy / compliance **[Brief]** | Accounts with a recorded consent before personal data is stored | **100 %** | Automated check that no account exists without a consent record; audit before each release |
| Privacy / compliance **[Brief]** | Time to complete a data-deletion request | **≤ 30 days** from submission **[Assumed target — to confirm with legal]** | Request queue report: submission date vs completion date |
| Security — payment **[Brief]** | Card numbers stored on LearnLanka systems | **0** | Scan of databases and logs for card-number patterns before each release; PCI-DSS attestation of the payment gateway on file |
| Localisation **[Brief]** | UI strings available in Sinhala, Tamil and English | **100 %** of strings in all three languages at launch; 0 missing translations shown to users | Automated string-coverage check on every build |
| Device support **[Assumed]** | Android versions supported | **Android 8.0 and above** **[Assumed — to confirm]** | Test run on a device matrix of at least 5 different Android phones |
| Financial accuracy **[Assumed]** | Completed sessions whose commission ≠ 15 % of the session price | **0** | Weekly reconciliation: sum of payouts + commission = sum of payments received for completed sessions |

---

## 5. Assumptions

Each assumption is a gap in the brief. The number in brackets points to the matching item in the ambiguity log.

1. **Time and currency.** All times are Sri Lanka Standard Time (UTC+5:30) and all amounts are in LKR. *(brief silent)*
2. **Booking is a request.** Because tutors "accept or decline" bookings, a booking starts as a request. The Student is only finally charged once the tutor accepts; a decline or expiry means no charge or a full refund. *(Ambiguity #5, #6)*
3. **Response window.** A tutor has up to 12 hours to answer a request, and never later than the session's start time; after that the request expires and the slot is released. *(#6)*
4. **Pricing.** The tutor sets their own hourly rate in LKR; the session price is that rate for one hour; "price band" is a Student-facing range of hourly rates. *(#3)*
5. **Cancellation.** The 12-hour rule applies to students too: cancelling at least 12 hours before start gives a full refund; later cancellation gives no refund. A tutor cancelling with at least 12 hours' notice always results in a full refund to the student. *(#7)*
6. **"Completed session".** A session is completed when its scheduled end time has passed and both participants joined the video room. Commission applies only to completed sessions. *(#8)*
7. **Commission base.** Commission is 15% of the price the student paid; the tutor receives the remaining 85%; payment-gateway fees are not deducted from the tutor's share. *(#8)*
8. **Payout schedule.** Payouts run once a week (every Monday) for sessions completed in the previous Monday–Sunday week, in LKR, to the tutor's verified bank account, with no minimum amount. *(#9)*
9. **Minors.** Some students are under 18; a parent or guardian gives consent for them. *(#14)*
10. **Ratings visibility.** A student's rating of a tutor is public on the tutor's profile; a tutor's rating of a student is visible only to LearnLanka Ops. A rating can be left within 7 days after the session; the comment is at most 140 characters. *(#10)*
11. **One-to-one sessions.** Each session has exactly one tutor and one student, so 200 sessions = 400 video participants. *(#13)*
12. **Video provider.** The provider (Daily.co or 100ms) is chosen later; the requirements do not depend on which. *(#17)*
13. **Platform focus.** Students and tutors use the mobile-first product, Android first; Ops Admins use a desktop browser. Delivery format (native app, PWA or responsive web) is left to design. *(#16)*
14. **Vetting is manual.** An Ops Admin reviews each tutor application before the tutor can appear in search. *(#2)*
15. **SMS gateway.** Mobile numbers are verified by one-time code (OTP) sent by SMS through an external SMS gateway; this external system is not named in the brief. *(not in brief)*
16. **Reminders.** Students and tutors receive a reminder before a confirmed session; the channel (SMS or in-app) is decided in design. *(not in brief)*

---

## 6. Out of Scope (for this version)

1. **Building video calling in-house**, and in-session tools beyond the provider's standard audio/video (whiteboard, file sharing, session recording). *The brief says video is outsourced.*
2. **Group classes** — more than one student in a session.
3. **Subscriptions, lesson packages, discounts and promo codes** — only single one-hour bookings are paid.
4. **Session lengths other than 1 hour** and **recurring (repeat) bookings**.
5. **Payment methods other than card and eZ Cash**, and currencies other than LKR.
6. **A separate native iOS app** *(decision pending — see Ambiguity #16)*.
7. **Automated tutor verification** (ID or background-check integrations); vetting is done by hand by Ops.
8. **Languages other than Sinhala, Tamil and English.**
9. **In-app text chat** between student and tutor outside the video session.
10. **Automated dispute resolution and analytics dashboards**; Ops resolves disputes by hand using FR-O5.
