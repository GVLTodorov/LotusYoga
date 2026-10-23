# StudioBook — class booking for a small yoga studio

## Background

"Lotus Yoga" is a small studio in Sofia: one room (max 14 mats), 3 instructors, about 20 classes a
week and roughly 150 regular clients.

Today bookings happen over Viber and Instagram messages. The owner, Maria, keeps a paper
notebook and an Excel sheet. Problems she has every week:

- Classes get overbooked because two instructors answer messages at the same time.
- People cancel one hour before, or just don't show up, and the spot stays empty.
- Clients buy 10-class cards. Nobody is sure how many classes are left on a card. Arguments.
- Maria spends ~1 hour every evening answering "is there a spot tomorrow at 18:30?".

She wants a simple web app where clients book themselves and she can see who is coming.

## Users

- **Clients** — mostly on their phones, many aged 35–60, not very technical. They will not
  install an app. Bulgarian is the main language; a few expats need English.
- **Instructors** (3) — need to see who is booked into _their_ class and mark attendance at the door.
- **Owner / admin** (Maria) — manages the schedule, class cards and clients. Uses a laptop.

## What clients need

- See this week's and next week's schedule: class name, time, instructor, free spots.
- Sign up with email + password. Phone number is required (Maria calls people when a class is cancelled).
- Book a spot in a class. You can't book if the class is full or if you have no classes left on your card.
- Join a **waiting list** when a class is full. If someone cancels, the first person on the
  waiting list gets the spot automatically and an email.
- Cancel a booking. Cancelling **less than 6 hours before** the class still uses up the class
  from the card (studio rule). The app must show this clearly before they confirm.
- See "My bookings" (upcoming + past) and how many classes are left on their card and when it expires.

## What instructors need

- A list of today's classes they teach, with the booked clients.
- Mark each person as **attended** or **no-show** at the start of class.
- Add a walk-in client who has a card but didn't book (if there is a free spot).

## What the owner needs

- Create/edit the weekly schedule. Most classes repeat every week at the same time; sometimes
  a single date is cancelled (holidays) or moved.
- Cancel a class. All booked clients get an email and their class goes back on their card.
- Manage class cards. Clients pay in cash or by bank transfer at the studio, so **there is no
  online payment**. Maria records the card in the app. Card types:
  - Single class — valid 1 month
  - 8 classes — valid 2 months
  - 12 classes — valid 3 months
  - Unlimited month — valid 1 month, max 1 booking per day
- See a client's history: cards bought, classes attended, no-shows.
- Simple monthly overview: classes held, average attendance per class, no-show count, cards sold.
- Block a client from booking (people who often don't show up).

## Notifications

Emails only (no SMS for now):

- Booking confirmation
- Got a spot from the waiting list
- Class cancelled by the studio
- Reminder the evening before the class
- Card has 1 class left / card expires in 3 days

## Rules and constraints

- Room capacity is 14 by default, but some classes (e.g. aerial yoga) have only 6 spots.
- Bookings open 14 days ahead and close 30 minutes before the class starts.
- Times are always in Bulgarian time (Europe/Sofia), including after daylight-saving changes.
- Client data is personal data (GDPR): clients can delete their account. Attendance history
  must stay for the studio's records, but anonymised.
- It must work well on a cheap Android phone and on a slow mobile connection.
- Maria wants to run it herself on the studio's existing small server, in Docker.

## Not needed now

- Online payments
- A mobile app
- Multiple studios / rooms
- Instructor salaries, invoices, accounting
- Marketing emails / newsletters

## Open questions (to clarify with Maria)

- What happens to the waiting list if a spot opens up less than 6 hours before class? Offer it
  anyway, or close the waiting list?
- Can a client book for a friend (2 spots with one card)?
- Do unused classes on an expired card get lost, or can Maria extend the card?
- Should instructors be able to see clients' phone numbers?
- Is a Bulgarian/English language switch needed from day one, or is Bulgarian enough for the first version?

## Success after the first month

- Zero double-bookings.
- Maria spends less than 15 minutes a day on bookings.
- At least 80% of bookings are made through the app instead of messages.
- No-shows go down. (Maria thinks ~15% today, but nobody really knows.)
