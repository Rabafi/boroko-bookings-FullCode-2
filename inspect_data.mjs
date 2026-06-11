import db from './src/main/database.js';

async function test() {
  const bookings = await db.getAllBookings();
  console.log("Booking keys:", Object.keys(bookings[0] || {}));
  console.log("Sample Booking:", bookings.find(b => b.amount_paid > 0) || bookings[0]);

  try {
    const logs = await db.getFinancialAuditLog();
    console.log("Log keys:", Object.keys(logs[0] || {}));
    console.log("Sample Log:", logs[0]);
  } catch(e) {
    console.log("getFinancialAuditLog error:", e.message);
  }

  try {
    const payments = await db.getBookingPayments(bookings[0].id);
    console.log("Payment keys:", Object.keys(payments[0] || {}));
    console.log("Sample Payment:", payments[0]);
  } catch(e) {
    console.log("getBookingPayments error:", e.message);
  }
}
test();
