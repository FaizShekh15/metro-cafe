# Metro Cafe — Complete Ordering Website

This is a ready-to-run Node.js + Express food ordering starter adapted from your Urban Cafe project. It includes a customer menu/cart/checkout, SQLite order storage, secure admin sign-in, and order status management.

## Requirements
- Node.js 20 or newer
- npm

## Start on Windows
1. Extract this ZIP. Open the extracted `urban-cafe-website-main` folder in VS Code.
2. In the VS Code terminal run `copy .env.example .env`.
3. Generate a password hash using your own password:
   `node -e "require('bcryptjs').hash('ChooseYourOwnStrongPassword', 12).then(console.log)"`
4. Open `.env` and replace `ADMIN_PASSWORD_HASH` with the printed hash. Set a unique `SESSION_SECRET` (32+ characters) and choose `ADMIN_USERNAME`. Never share your admin password.
5. Run `npm install` then `npm start`.
6. Open `http://localhost:3000` for the customer website and `http://localhost:3000/admin` for admin.

## Menu configured
- Drinks: Coffee ₹50, Milkshake ₹100, Coke ₹50, Latte ₹150
- Veg: Aloo Paratha ₹130
- Non-Veg: Chicken Rice Half ₹50 / Full ₹90; Chicken Noodles Half ₹50 / Full ₹90

## Important
- Admin login requires your `.env` setup; no default password is provided.
- Orders are stored in `data/metro-cafe.sqlite`; deploy only on a Node.js host with persistent disk for SQLite.
- The existing delivery validation is set to Lunawada/Lunavada. Update the validation in `server.js` if your delivery area is different.
- WhatsApp contact number is configured in `public/index.html`; verify/change it to the cafe's official number before accepting real orders.
- Customer account sign-up is a demo-only browser feature, not a secure customer account system. UPI is only a payment preference and is not verified by the site. Test thoroughly before public launch.
