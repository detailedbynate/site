// --------------------------------------------------------------------------
// Starting text for the Privacy Policy and Terms pages.
//
// Written against what this site ACTUALLY does — the fields the booking form
// collects, the processors it really talks to (Stripe, Resend, Google
// Calendar), and the cancellation rules the policy settings enforce. A
// generic template that lists cookies you don't set and data you don't
// collect is worse than nothing: it is a promise you can't keep.
//
// {{...}} placeholders are filled from Settings so the business name, contact
// details and cancellation window stay in step with the rest of the app.
//
// NOT legal advice. This is a starting draft for the owner to edit and, for
// anything that matters, have checked.
// --------------------------------------------------------------------------

export const DEFAULT_PRIVACY = `## Who we are

{{business}} ("we") provides mobile and in-shop car detailing. If you have any
question about this policy, contact us at {{email}}{{phoneClause}}.

## What we collect

When you book, we ask for your name, email address, phone number, vehicle
details, and — for mobile jobs — the address where the work will happen. We
also keep anything you type into the notes field, and a record of the
services you booked and what you paid.

If we take photographs of your vehicle before and after a job, we keep those
too. We will not publish a photograph of your vehicle without asking you
first.

## Why we collect it

To do the work you booked, to contact you about that booking, to take
payment, and to keep accurate business records. That is all.

## Who else sees it

We use a small number of services to run the business:

- **Stripe** processes card payments. Your card details go to Stripe directly
  and are never stored on our systems.
- **Resend** sends booking confirmations and reminders on our behalf.
- **Google Calendar** holds the schedule, so a booking appears as an entry in
  our calendar.

Each of these only receives what it needs. We do not sell your information,
and we do not share it for advertising.

## How long we keep it

We keep booking and payment records for as long as we need them for
accounting and tax purposes. You can ask us to delete anything else at any
time.

## Cookies

The public site sets no tracking cookies. The only cookie we use is the one
that keeps the shop owner signed in to the admin area, which is necessary for
the site to work.

## Your choices

You can ask us for a copy of what we hold about you, ask us to correct it, or
ask us to delete it. Email {{email}} and we will sort it out.

Last updated: {{updated}}`;

export const DEFAULT_TERMS = `## Booking

A booking is confirmed when you receive a confirmation email from us. Prices
shown at booking are for the vehicle and condition described. If a vehicle
turns out to need substantially more work than booked — heavy pet hair, spills,
or excessive soiling — we will tell you before starting and agree any change
in price with you first.

## Deposits and payment

Where a deposit is required, it is stated at booking and payable through the
link we send you. The balance is due on the day the work is completed unless
we have agreed otherwise in writing.

## Changing or cancelling

You can change or cancel your booking using the link in your confirmation
email.

{{cancellationPolicy}}

Missed appointments, and jobs where we cannot access the vehicle at the
agreed time and place, are treated as late cancellations.

## Access and conditions for mobile work

For mobile jobs you must provide safe, legal access to the vehicle and
somewhere we can work. Where a job needs water or power, please let us know in
advance if it is not available.

We may reschedule for weather where it would affect the quality of the work.
We will always give you as much notice as we can, and there is no charge for a
booking we move.

## Your vehicle

Please remove personal belongings before your appointment. We are not
responsible for items left in the vehicle.

We take care with every vehicle, but we cannot be responsible for pre-existing
damage, or for damage arising from a fault or defect that was already present
— for example, failing trim, existing rust, or previous paint repairs. We will
point out anything of that sort before starting where we notice it.

## Results

Detailing improves the condition of a vehicle; it does not make it new. Deep
scratches, etched paint, burns, tears and permanent staining may not come out.
Where we think an expectation is unrealistic, we will say so before starting
rather than after.

## Complaints

If you are unhappy with the work, tell us within 48 hours and we will come and
look at it. Contact {{email}}{{phoneClause}}.

Last updated: {{updated}}`;

/** Fill the placeholders from settings. Unknown ones are left as-is. */
export function renderLegal(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in vars ? vars[key] : whole,
  );
}
