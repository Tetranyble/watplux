# SOLAR E-COMMERCE PLATFORM — MASTER DEVELOPMENT INSTRUCTION

You are acting as the **Lead Software Architect, Senior Full-Stack Engineer, Database Engineer, Security Engineer, Performance Engineer and DevOps Engineer** for this project.

We are building a production-grade e-commerce platform for a solar energy business.

The business sells:

* Solar panels
* Inverters
* Batteries
* Charge controllers
* Solar cables
* Mounting accessories
* Protection devices
* Solar installation accessories
* Other renewable-energy products

The business also provides:

* Solar consultation
* Solar system sizing
* Installation services
* Maintenance
* Possibly custom solar system quotations

The platform must support both **online product sales** and **service/consultation requests**.

The payment provider is **Paystack**.

The primary database is **MySQL**.

---

# IMPORTANT DEVELOPMENT RULE

DO NOT attempt to build the entire application in one step.

Build the system incrementally in clearly defined phases.

After completing each phase:

1. Inspect the implementation.
2. Run the relevant tests.
3. Check for type errors.
4. Check for lint errors.
5. Check database migrations.
6. Check security implications.
7. Check performance implications.
8. Summarize what was implemented.
9. List files created/modified.
10. Explain any architectural decisions.
11. Identify anything that must be fixed before proceeding.
12. STOP.

Do not automatically continue to the next phase.

Wait for my instruction to proceed.

Do not create fake implementations or placeholder logic for core functionality.

If something is ambiguous, make a reasonable engineering assumption and document it rather than inventing unnecessary complexity.

---

# CORE ENGINEERING PRINCIPLES

The application must be:

* Fast
* Secure
* SEO-friendly
* Mobile-first
* Accessible
* Scalable
* Maintainable
* Type-safe
* Database-efficient
* Production-ready

Do not over-engineer the MVP.

However, do not use shortcuts that create technical debt in core business functionality.

Prioritize:

1. Correctness
2. Security
3. Performance
4. Maintainability
5. UX
6. Visual polish

---

# TECHNOLOGY STACK

Use:

Frontend:

* Next.js
* React
* TypeScript
* Tailwind CSS
* shadcn/ui where appropriate
* TanStack Query only where client-side server state actually requires it
* React Hook Form
* Zod

Backend:

* Next.js server-side architecture/API layer unless there is a strong architectural reason to separate the backend
* TypeScript
* RESTful API boundaries where appropriate

Database:

* MySQL

ORM:

* Use Prisma unless there is a strong technical reason to use another mature MySQL ORM.

Payments:

* Paystack

Authentication:

* Secure session-based authentication or a mature Next.js-compatible authentication solution.
* Do not implement cryptography or authentication primitives manually.

Storage:

* Use object storage for product images rather than storing binary images inside MySQL.

Deployment:

* Production deployment must be designed for a Linux environment.
* Containerization should be considered.
* Environment variables must be used for secrets.

---

# PROJECT ARCHITECTURE

Before writing significant application code, establish a clean architecture.

Separate:

* UI
* Application/business logic
* Data access
* Payment integration
* Authentication
* Validation
* Background/event processing
* Infrastructure

Avoid putting business logic directly inside React components.

Avoid huge route handlers.

Avoid duplicated database queries.

Avoid duplicated validation logic.

---

# USERS

The platform should initially support:

## Customer

Customers can:

* Browse products
* Search products
* Filter products
* View product details
* Add products to cart
* Checkout
* Pay with Paystack
* View orders
* Track order status
* Manage profile
* Save addresses
* Request consultation
* Request installation
* Contact the business

Customers should be able to purchase without creating an account if we decide to support guest checkout.

Design the architecture so guest checkout can be supported cleanly.

---

# ADMIN

Create an administrative dashboard.

Admin functionality should eventually include:

* Dashboard
* Products
* Categories
* Brands
* Inventory
* Orders
* Customers
* Payments
* Discounts
* Coupons
* Consultation requests
* Installation requests
* Product reviews
* Media
* Settings
* Audit logs

Admin access must be protected using RBAC.

Do not rely only on frontend route protection.

Authorization must also be enforced server-side.

---

# PRODUCT SYSTEM

Products must support:

* Name
* Slug
* SKU
* Description
* Short description
* Brand
* Category
* Product images
* Price
* Compare-at price
* Cost price where appropriate
* Stock quantity
* Low-stock threshold
* Product status
* Featured flag
* Weight
* Dimensions
* Warranty information
* Specifications
* SEO metadata

Products may have:

* Variants
* Different capacities
* Different sizes
* Different power ratings
* Different colors
* Different configurations

Do not assume every product needs variants.

Design variants properly where required.

---

# SOLAR-SPECIFIC PRODUCT DATA

The product model should allow structured technical specifications.

Examples:

Solar panel:

* wattage
* voltage
* current
* efficiency
* cell type
* dimensions
* weight

Inverter:

* rated power
* surge power
* input voltage
* output voltage
* phase
* battery voltage
* efficiency
* MPPT range

Battery:

* chemistry
* capacity
* voltage
* cycle life
* depth of discharge
* warranty

Do not create dozens of nullable database columns for every possible solar specification.

Use a structured specification model where appropriate.

However, important fields that are heavily queried or filtered should have proper database columns.

---

# CATEGORY SYSTEM

Support hierarchical categories.

Example:

Solar Products
├── Solar Panels
├── Inverters
│   ├── Hybrid Inverters
│   ├── Off-grid Inverters
│   └── Grid-tie Inverters
├── Batteries
│   ├── Lithium
│   └── Gel
├── Charge Controllers
├── Solar Cables
├── Protection
└── Accessories

Categories must support:

* Name
* Slug
* Description
* Parent category
* Image
* SEO metadata
* Active/inactive state
* Sort order

---

# INVENTORY

Inventory must not simply be:

products.stock_quantity

Design proper inventory handling.

Consider:

* Inventory items
* Stock movements
* Purchase/restock
* Order reservation
* Sale
* Cancellation
* Return
* Manual adjustment

Every stock-changing operation should have traceability.

Avoid race conditions during checkout.

Inventory updates must be transactional.

---

# CART

Cart must support:

* Guest cart
* Authenticated cart
* Product variants
* Quantity
* Price snapshot
* Stock validation
* Cart expiration where appropriate

Never trust prices or totals submitted by the browser.

The server must calculate:

* Product prices
* Discounts
* Shipping
* Taxes if applicable
* Final total

---

# ORDER SYSTEM

Orders should contain immutable snapshots of important purchase information.

An order should not depend on the current product record to reconstruct what the customer purchased.

Store snapshots such as:

* Product name
* SKU
* Unit price
* Quantity
* Product/variant identifier
* Discount
* Tax if applicable
* Line total

Order statuses should be explicit.

Example:

PENDING_PAYMENT
PAID
PROCESSING
READY_FOR_DISPATCH
SHIPPED
DELIVERED
CANCELLED
REFUNDED

Design a proper order state transition system rather than allowing arbitrary status changes.

---

# PAYMENT SYSTEM

Use Paystack.

IMPORTANT:

Never expose the Paystack secret key to the browser.

Paystack secret operations must happen server-side.

Use:

* Transaction initialization
* Transaction verification
* Paystack webhook

The browser redirect/callback must NOT be considered sufficient proof of payment.

Payment confirmation must be performed server-side.

Webhook requests must be authenticated using Paystack's signature mechanism.

Payment processing must be idempotent.

The same Paystack event must never cause:

* duplicate orders
* duplicate inventory deductions
* duplicate fulfillment
* duplicate payment records

Store the Paystack transaction reference.

Use unique constraints where appropriate.

The internal payment record should include appropriate information such as:

* order ID
* Paystack reference
* amount
* currency
* status
* channel
* gateway response
* paid timestamp
* raw event metadata where appropriate
* verification timestamp

Amounts must be handled safely.

Do not use floating point arithmetic for money.

Represent monetary amounts using integer minor units where appropriate.

For NGN, Paystack expects transaction amounts in the currency's subunit when using the API.

Paystack's current documentation recommends webhooks over relying solely on customer callbacks because customer connectivity can cause callback failures.

Webhook processing should:

1. Receive event.
2. Validate signature.
3. Quickly acknowledge the webhook.
4. Process safely/idempotently.
5. Update payment.
6. Update order.
7. Update inventory where appropriate.
8. Trigger fulfillment-related actions.

Do not perform long-running work before returning the webhook response.

---

# CHECKOUT

Checkout should contain:

Customer information:

* Name
* Email
* Phone

Delivery:

* Address
* City
* State
* Country
* Delivery notes

Order summary:

* Products
* Quantities
* Discounts
* Delivery fee
* Total

Payment:

* Paystack

Before payment initialization:

1. Validate cart.
2. Validate stock.
3. Recalculate prices.
4. Calculate total.
5. Create order/payment intent.
6. Generate unique payment reference.
7. Initialize Paystack.
8. Return payment authorization URL/access information.

Never allow the client to tell the server:

"the order total is ₦500,000."

The server calculates the amount.

---

# CONSULTATION SYSTEM

Because this is a solar business, build a consultation request system.

Customers should be able to request:

* Solar consultation
* Solar system sizing
* Installation
* Maintenance
* Site assessment

Possible fields:

* Name
* Email
* Phone
* Location
* Property type
* Current electricity situation
* Estimated monthly electricity usage
* Appliances
* Desired backup duration
* Existing solar equipment
* Budget range
* Preferred appointment date
* Additional information

Do not force every field to be required.

Allow the business to configure service request statuses.

---

# SOLAR SYSTEM SIZING

Design the architecture so a future solar calculator can be added.

The calculator may eventually estimate:

* Daily energy consumption
* Required inverter capacity
* Battery capacity
* Solar panel capacity
* Number of panels
* Estimated backup time

Do NOT build a scientifically inaccurate calculator just to have a feature.

For the MVP, create the domain boundary/interface so the calculation engine can be introduced properly later.

---

# SEARCH

Build fast product search.

Support:

* Product name
* SKU
* Brand
* Category
* Relevant specifications

Consider MySQL indexes and full-text search before introducing Elasticsearch/OpenSearch.

Do not introduce Elasticsearch unless there is a demonstrated requirement.

---

# PERFORMANCE

Performance is a first-class requirement.

The website should:

* Minimize JavaScript sent to the browser.
* Prefer server components where appropriate.
* Use client components only where interactivity requires them.
* Optimize images.
* Use responsive images.
* Lazy-load non-critical media.
* Avoid unnecessary API calls.
* Avoid N+1 database queries.
* Use proper indexes.
* Paginate product lists.
* Avoid loading thousands of products.
* Cache suitable read-heavy data.
* Use CDN/object storage for images.
* Avoid unnecessary global state.
* Avoid expensive client-side computations.

The homepage should be designed to load extremely quickly.

Product/category pages must be SEO-friendly and performant.

---

# SEO

Implement:

* Metadata
* Open Graph metadata
* Twitter/X metadata where useful
* Canonical URLs
* Sitemap
* robots.txt
* Product structured data
* Breadcrumb structured data where appropriate
* Category metadata
* Product metadata
* SEO-friendly slugs

Product pages must be indexable.

Do not build an e-commerce website where all product content exists only after client-side JavaScript executes.

---

# URL STRUCTURE

Design clean URLs.

Example:

/
/products
/products/solar-panels
/products/inverters
/products/batteries
/products/solar-panels/450w-mono-solar-panel
/categories/inverters
/services
/services/solar-consultation
/services/installation
/consultation
/cart
/checkout
/account
/orders
/orders/[orderNumber]

Use human-readable slugs.

---

# DATABASE

Design the MySQL schema carefully before implementing all features.

Potential entities include:

users
roles
permissions
user_roles

products
product_variants
product_images
product_specifications

categories
brands

inventory_items
inventory_movements

carts
cart_items

orders
order_items
order_addresses
order_status_history

payments
payment_events

addresses

coupons
coupon_redemptions

consultation_requests
installation_requests

reviews

media

audit_logs

settings

Do not blindly create every table listed above.

Evaluate relationships and normalize the schema appropriately.

Use:

* Foreign keys
* Unique constraints
* Composite indexes
* Appropriate indexes
* Transactions
* Timestamps
* Soft deletion only where it actually makes sense

---

# DATABASE PERFORMANCE

For every important query, think about:

* Index usage
* Cardinality
* Sorting
* Filtering
* Pagination
* Joins

Do not add indexes blindly.

Do not use:

SELECT *

when unnecessary.

Do not fetch entire product tables when rendering a product listing.

Use cursor pagination where it provides a real benefit.

---

# SECURITY

Implement:

* Secure authentication
* Authorization
* Input validation
* Zod validation
* SQL injection protection through ORM/query parameterization
* CSRF protection where applicable
* Rate limiting
* Secure cookies
* Password hashing through established libraries
* Security headers
* Content Security Policy where practical
* Request size limits
* File upload validation
* MIME/type validation
* File size limits
* Audit logging for sensitive admin actions

Never trust:

* Client-side price
* Client-side stock
* Client-side user role
* Client-side order status
* Client-side payment status

---

# ADMIN SECURITY

Admin endpoints must verify permissions server-side.

Example permissions:

products.read
products.create
products.update
products.delete

orders.read
orders.update

inventory.read
inventory.adjust

customers.read

payments.read

consultations.read
consultations.update

settings.manage

Do not simply check:

if user.role === "admin"

for every authorization requirement.

Design authorization so it can evolve.

---

# ADMIN DASHBOARD

The dashboard should eventually provide:

* Revenue
* Orders
* Pending orders
* Paid orders
* Low-stock products
* Top products
* Recent orders
* Recent customers
* Consultation requests
* Payment status

Use efficient aggregate queries.

Do not load all orders and calculate revenue in JavaScript.

---

# PRODUCT MEDIA

Product images must be optimized.

Support:

* Main image
* Gallery
* Thumbnail
* Alt text
* Sort order

Do not store image binaries in MySQL.

Use object storage.

---

# EMAIL / NOTIFICATIONS

Design notification boundaries for:

Customer:

* Order confirmation
* Payment confirmation
* Order processing
* Shipping notification
* Delivery notification
* Consultation confirmation

Admin:

* New order
* New consultation request
* Low stock

Do not tightly couple notification delivery to core transaction processing.

---

# TESTING

Create tests for critical business logic.

At minimum:

Unit tests:

* Cart totals
* Discounts
* Inventory calculations
* Order totals
* Payment amount calculation

Integration tests:

* Checkout
* Order creation
* Payment initialization
* Payment verification
* Webhook processing
* Inventory deduction

Authorization tests:

* Customer cannot access admin
* Admin permissions work correctly

Idempotency tests:

* Same webhook processed twice
* Same payment callback processed twice

Do not consider the project complete until critical payment/order flows are tested.

---

# OBSERVABILITY

Prepare for:

* Structured logging
* Error tracking
* Payment failures
* Webhook failures
* Database errors
* Slow queries
* API latency

Never log:

* Paystack secret key
* Passwords
* Full authentication tokens
* Sensitive payment information

---

# UX

The storefront should feel like a premium modern solar-energy company.

Design language:

* Clean
* Professional
* Technical
* Trustworthy
* Modern
* Premium
* Conversion-focused

Avoid generic template-looking e-commerce UI.

The site should immediately communicate:

"These people understand solar energy and can be trusted with a serious investment."

Product pages should emphasize:

* Product imagery
* Price
* Availability
* Technical specifications
* Warranty
* Compatibility
* Delivery
* Installation options
* Add to cart
* Request consultation

---

# MOBILE

Mobile is a first-class experience.

Design for:

* 320px+
* 375px
* 390px
* 430px
* Tablet
* Desktop

Checkout must be extremely easy on mobile.

---

# ACCESSIBILITY

Follow WCAG principles.

Ensure:

* Keyboard navigation
* Proper labels
* Focus states
* Semantic HTML
* Accessible dialogs
* Accessible forms
* Sufficient contrast
* Screen-reader-friendly controls

---

# DEVELOPMENT WORKFLOW

Follow this exact sequence.

PHASE 0
Project discovery and architecture.

PHASE 1
Repository setup and application foundation.

PHASE 2
Database architecture and migrations.

PHASE 3
Authentication and authorization.

PHASE 4
Product/catalog system.

PHASE 5
Inventory system.

PHASE 6
Storefront UI.

PHASE 7
Cart.

PHASE 8
Checkout.

PHASE 9
Paystack integration.

PHASE 10
Orders and fulfillment.

PHASE 11
Admin dashboard.

PHASE 12
Solar consultation/service system.

PHASE 13
Search and SEO.

PHASE 14
Performance optimization.

PHASE 15
Security hardening.

PHASE 16
Testing.

PHASE 17
Production deployment.

PHASE 18
Final audit.

---

# PHASE 0 — START HERE

Do NOT start coding the entire application.

Start by producing:

1. Recommended architecture.
2. Folder structure.
3. Database ERD/domain model.
4. Entity relationships.
5. Authentication architecture.
6. Payment architecture.
7. Inventory architecture.
8. Order lifecycle.
9. Checkout lifecycle.
10. Paystack payment lifecycle.
11. Admin permission model.
12. Caching strategy.
13. Image/media strategy.
14. SEO strategy.
15. Deployment architecture.
16. Testing strategy.
17. Security strategy.
18. Performance strategy.
19. Major architectural risks.
20. Recommended MVP scope.

Then STOP.

Do not implement Phase 1 until I explicitly tell you:

"Proceed to Phase 1."

When I say "Proceed to Phase X", implement only that phase.

After completing it, test it, review it, summarize it, and STOP again.

Do not skip phases.

Do not build future phases prematurely.

The goal is not merely to produce a website that looks good.

The goal is to produce a **high-performance, secure, scalable, production-grade solar e-commerce platform.**
