Customer
   │
   ▼
Cart
   │
   ▼
Server recalculates:
- products
- prices
- discounts
- delivery
- total
   │
   ▼
Create Order
   │
   ▼
Create Payment Record
   │
   ▼
Paystack Initialize
   │
   ▼
Paystack Checkout
   │
   ├──────────────► Customer callback
   │
   └──────────────► Paystack Webhook
                         │
                         ▼
                  Verify signature
                         │
                         ▼
                  Idempotency check
                         │
                         ▼
                  Verify payment
                         │
                         ▼
                 Mark Payment PAID
                         │
                         ▼
                  Mark Order PAID
                         │
                         ▼
                 Deduct/confirm stock
                         │
                         ▼
                  Begin fulfillment