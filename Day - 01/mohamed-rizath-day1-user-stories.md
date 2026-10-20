# LearnLanka — User Story Set v0.1

**Author:** Mohamed Rizath  |  **Date:** 20 October 2026

12 stories: **Student** (Stories 1, 2, 3, 4, 12), **Tutor** (Stories 5, 6, 7, 8, 9), **Ops Admin** (Stories 10, 11).
Story 2 and Story 12 capture non-functional concerns (search speed, data privacy).
Assumption numbers (A#) refer to Section 5 of `mohamed-rizath-day1-requirements.md`; ambiguity numbers (#) refer to `mohamed-rizath-day1-ambiguity-log.md`.

---

## Story 1: Search for a tutor

**As a** Student
**I want** to search for tutors by subject, grade, language and price band
**So that** I can find a tutor who fits my syllabus, my language and my family's budget

### Acceptance Criteria
- **Given** I am on the search screen **when** I choose subject "Combined Mathematics", grade "A/L", language "Tamil" and a price band, and run the search **then** every tutor listed teaches that subject and grade in Tamil and has an hourly rate inside the chosen band.
- **Given** the filters I chose match no tutor **when** the search finishes **then** I see a "no tutors found" message and can change the filters.
- **Given** search results are shown **when** I look at any result **then** it shows the tutor's name, teaching language(s), hourly rate and average rating.

### INVEST self-check
- [ ] Independent — needs tutor profiles to exist first, which depends on Story 11 (vetting)
- [x] Negotiable
- [x] Valuable
- [x] Estimable
- [x] Small
- [x] Testable

---

## Story 2: Fast search on a mobile connection (non-functional)

**As a** Student on a Sri Lankan mobile or home internet connection
**I want** tutor search results to appear quickly
**So that** I do not give up before I find a tutor

### Acceptance Criteria
- **Given** a synthetic test client on a Sri Lankan ISP **when** it runs a tutor search repeatedly over a 24-hour period **then** the 95th-percentile response time is under 800 ms.
- **Given** the 95th-percentile search time rises above 800 ms for a 15-minute period **when** the monitoring check runs **then** an alert is sent to the team.

### INVEST self-check
- [ ] Independent — only makes sense once Story 1 (search) exists
- [x] Negotiable — the 800 ms target is fixed by the brief, but the measuring method can be discussed
- [x] Valuable
- [x] Estimable
- [x] Small
- [x] Testable

---

## Story 3: Book a session and pay

**As a** Student
**I want** to book a 1-hour session in a tutor's available slot and pay by card or eZ Cash
**So that** my lesson is secured and I know it will happen

### Acceptance Criteria
- **Given** a tutor has an open slot **when** I book it and pay by card **then** my booking shows "Awaiting tutor" and no other student can book that slot.
- **Given** a tutor has an open slot **when** I book it and pay with eZ Cash **then** my booking shows "Awaiting tutor" and no other student can book that slot.
- **Given** my booking is "Awaiting tutor" **when** the tutor accepts **then** I am notified, the booking shows "Confirmed" and my payment is final. *(A2)*
- **Given** my booking is "Awaiting tutor" **when** the tutor declines or does not answer within 12 hours **then** I am notified, I am not charged (or am refunded in full) and the slot becomes available again. *(A2, A3)*
- **Given** my payment fails **when** I try to book **then** no booking is created and I see why it failed.

### INVEST self-check
- [ ] Independent — depends on Story 5 (slots exist) and Story 6 (tutor accepts)
- [x] Negotiable
- [x] Valuable
- [x] Estimable
- [ ] Small — booking and paying are two capabilities; should be split into "book a slot" and "pay for a booking" before sprint planning
- [x] Testable

---

## Story 4: Rate my tutor

**As a** Student
**I want** to rate my tutor 1–5 stars and leave a one-line comment after our session
**So that** other students can choose tutors with confidence and the tutor gets honest feedback

### Acceptance Criteria
- **Given** my session is completed **when** I submit 4 stars and a comment **then** the rating is saved and shown on the tutor's profile. *(A10)*
- **Given** I have already rated this session **when** I try to rate it again **then** I am told I already rated it and nothing changes.
- **Given** my session was not completed (for example, cancelled) **when** I try to rate it **then** I cannot submit a rating.
- **Given** I type a comment longer than 140 characters **when** I submit **then** I am asked to shorten it. *(A10)*

### INVEST self-check
- [ ] Independent — needs a completed session, which depends on Story 3
- [x] Negotiable
- [x] Valuable
- [x] Estimable
- [x] Small
- [x] Testable

---

## Story 5: Publish my availability

**As a** Tutor
**I want** to publish the hours I am free to teach
**So that** students can only book times that suit me and I avoid double bookings

### Acceptance Criteria
- **Given** I am an approved tutor **when** I add a 1-hour slot on a future date and time **then** the slot appears in my availability and students can see it on my profile.
- **Given** I add a slot that overlaps one of my existing slots **when** I save **then** it is rejected and I am told which slot it clashes with.
- **Given** a slot is already booked **when** I try to remove it **then** I am told that I must cancel the booking instead.

### INVEST self-check
- [ ] Independent — I can only publish once Ops has approved me (Story 11)
- [x] Negotiable
- [x] Valuable
- [x] Estimable
- [x] Small
- [x] Testable

---

## Story 6: Accept or decline a booking

**As a** Tutor
**I want** to accept or decline each booking request
**So that** I only teach sessions I can really give

### Acceptance Criteria
- **Given** I have a booking request **when** I accept it **then** the booking becomes "Confirmed" and the student is notified.
- **Given** I have a booking request **when** I decline it **then** the student is notified, is not charged (or is refunded in full) and the slot becomes available again.
- **Given** I have not answered a request for 12 hours **when** the time passes **then** the request expires and the student is notified. *(A3)*

### INVEST self-check
- [ ] Independent — needs a student request from Story 3
- [x] Negotiable
- [x] Valuable
- [x] Estimable
- [x] Small
- [x] Testable

---

## Story 7: Cancel with enough notice

**As a** Tutor
**I want** to cancel a confirmed session when something unexpected comes up, as long as I give enough notice
**So that** I can stay fair to students and keep my reputation

### Acceptance Criteria
- **Given** a confirmed session starts in 12 hours or more **when** I cancel it **then** the session is cancelled, the student is notified and the student is fully refunded.
- **Given** a confirmed session starts in exactly 12 hours **when** I cancel it **then** the cancellation is allowed (the brief says "at least 12 hours").
- **Given** a confirmed session starts in less than 12 hours **when** I try to cancel it **then** the cancellation is refused and I am told the 12-hour rule is the reason.

### INVEST self-check
- [x] Independent
- [x] Negotiable
- [x] Valuable
- [ ] Estimable — what happens to a tutor who cannot attend inside 12 hours (penalty? Ops contact?) is undefined (Ambiguity #7)
- [x] Small
- [x] Testable

---

## Story 8: Rate my student

**As a** Tutor
**I want** to rate my student 1–5 stars and leave a one-line comment after the session
**So that** LearnLanka knows about punctuality and behaviour problems

### Acceptance Criteria
- **Given** my session is completed **when** I submit 5 stars and a comment **then** the rating is saved and visible to LearnLanka Ops. *(A10)*
- **Given** I have already rated this session **when** I try again **then** I am told I already rated it and nothing changes.

### INVEST self-check
- [ ] Independent — needs a completed session
- [ ] Negotiable — who may see tutor ratings of students (Ops only? the student too?) is an open question (Ambiguity #10)
- [x] Valuable
- [x] Estimable
- [x] Small
- [x] Testable

---

## Story 9: Get paid every week

**As a** Tutor
**I want** to receive my earnings every week by bank transfer, net of the 15% commission
**So that** I can rely on a predictable income

### Acceptance Criteria
- **Given** I completed one session priced LKR 2,000 that week **when** the weekly payout is calculated **then** my payout for that session is LKR 1,700 and the commission is LKR 300.
- **Given** I completed no sessions that week **when** the weekly payout is calculated **then** no payout is created for me.
- **Given** the bank transfer fails **when** the bank reports the failure **then** my payout shows "Failed" and I am notified.
- **Given** a payout has been made **when** I open my earnings **then** I see each session, its commission and the net amount.

### INVEST self-check
- [ ] Independent — needs completed sessions and Story 10 (batch review)
- [x] Negotiable
- [x] Valuable
- [ ] Estimable — how payouts are sent through Sampath Vishwa (file upload, API, manual?) is unknown (Ambiguity #9)
- [x] Small
- [x] Testable

---

## Story 10: Review and approve the weekly payout batch

**As an** Ops Admin
**I want** to review each week's payout batch with the commission shown per session
**So that** tutors are paid the right amount and LearnLanka books its 15%

### Acceptance Criteria
- **Given** the week has ended **when** I open the payout batch **then** every completed session is listed with its price, 15% commission and net amount, and the batch total equals the sum of its lines.
- **Given** I find an error **when** I exclude a line and enter a reason **then** the batch total updates and the exclusion is logged with my name and the reason.
- **Given** I approve the batch **when** it is submitted to the bank **then** it can no longer be edited and each payout is marked "Paid" or "Failed" when the bank responds.

### INVEST self-check
- [ ] Independent — needs completed sessions and the ledger from FR-O2
- [x] Negotiable
- [x] Valuable
- [ ] Estimable — depends on the unknown bank integration (Ambiguity #9)
- [ ] Small — review, exclude and submit are three separate capabilities; consider splitting
- [x] Testable

---

## Story 11: Vet tutors

**As an** Ops Admin
**I want** to approve, reject or suspend tutor applications
**So that** only vetted tutors appear in student search

### Acceptance Criteria
- **Given** a pending tutor application **when** I approve it **then** the tutor becomes visible in student search and can publish slots.
- **Given** a pending tutor application **when** I reject it and enter a reason **then** the tutor is notified and stays hidden from search.
- **Given** an approved tutor **when** I suspend them **then** they disappear from search and I am shown their confirmed future bookings so I can deal with them.

### INVEST self-check
- [x] Independent
- [x] Negotiable
- [x] Valuable
- [ ] Estimable — the vetting criteria (qualifications, ID, interview?) are unknown (Ambiguity #2)
- [x] Small
- [x] Testable

---

## Story 12: Control my personal data (non-functional — privacy)

**As a** Student
**I want** to give or withdraw consent for my personal data and ask for it to be deleted
**So that** LearnLanka respects my rights under Sri Lanka's Personal Data Protection Act 2022

### Acceptance Criteria
- **Given** I am creating an account **when** I reach the sign-up step **then** I must give consent before any personal data is saved, and the consent is recorded with the date and time.
- **Given** I am signed in **when** I submit a deletion request **then** I receive a confirmation with a reference number and the request appears in the Ops Admin's queue.
- **Given** Ops completes my request **when** the work is done **then** my personal data is removed or anonymised, I am notified, and the completion date is recorded within 30 days of my request. *(assumed target)*

### INVEST self-check
- [x] Independent
- [x] Negotiable
- [x] Valuable
- [ ] Estimable — retention rules (what must be kept for financial records) and the position for students under 18 are unknown (Ambiguity #14, #15)
- [ ] Small — consent capture and deletion handling are two flows; consider splitting
- [x] Testable
