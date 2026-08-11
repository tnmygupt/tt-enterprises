import type { Locale } from "@/lib/types";

export type HelpStep = {
  title: string;
  body: string;
  tip?: string;
};

export type HelpGuide = {
  id: "dealer" | "admin" | "accounts";
  title: string;
  subtitle: string;
  videoLabel: string;
  writtenLabel: string;
  durationHint: string;
  steps: HelpStep[];
};

const dealerEn: HelpGuide = {
  id: "dealer",
  title: "Dealer how-to guide",
  subtitle:
    "From signup to delivery — how to place estimates, pay, and track orders on TT Enterprises.",
  videoLabel: "Watch walkthrough",
  writtenLabel: "Read steps",
  durationHint: "About 3 minutes",
  steps: [
    {
      title: "1. Register & wait for approval",
      body: "Open the home page → Sign up with your mobile number, name, company, address and pincode. Phone is your login ID. After signup, wait until TT Enterprises approves your account — then you can log in.",
      tip: "Use a real mobile number. Wrong number = you cannot get OTPs or WhatsApp updates later.",
    },
    {
      title: "2. Log in",
      body: "On the home page, open the Login tab. Enter mobile + password. After login you see Price List, Catalog, Quick Order, My Orders, Schemes and Wallet.",
    },
    {
      title: "3. Check rates",
      body: "Open Price List for a flat size×rate sheet, or Catalog for product photos and stock. Rates are ₹ per kg (bundle total = rate × weight).",
    },
    {
      title: "4. Build an order (Quick Order)",
      body: "Quick Order is fastest: pick product → size → colour → bundles. Subtotal and shipping update live. Checkout when ready.",
      tip: "Stock is limited per size×colour. If a size shows 0, pick another colour or size.",
    },
    {
      title: "5. Place an estimate",
      body: "On Checkout, confirm name, phone, transport, address and pincode. Optionally apply wallet credit. Tap Place estimate. This reserves stock — it is not the final bill yet.",
    },
    {
      title: "6. Track stages",
      body: "Open My Orders → your order. Stages: Estimate → Confirmed → Bill / payment → Payment verified → Dispatched → LR → Delivered.",
    },
    {
      title: "7. Pay the final bill",
      body: "After admin uploads the final bill (from actual kg), open the order. Pay via UPI QR or bank transfer for the amount shown, then upload payment proof on the same page.",
      tip: "Always pay the Saved / Final bill amount (whole rupees), not an older estimate if weights changed.",
    },
    {
      title: "8. Delivery & LR",
      body: "When staff uploads the LR number, the order is marked Delivered. You can open the order anytime to see LR No. and bill documents.",
    },
    {
      title: "9. Schemes & wallet",
      body: "Schemes: lifting rewards based on actual billed weight after schemes end. Wallet: credit deposits and scheme payouts — use at checkout when available.",
    },
  ],
};

const dealerHi: HelpGuide = {
  id: "dealer",
  title: "डीलर कैसे-करें गाइड",
  subtitle:
    "रजिस्टर से डिलीवरी तक — TT Enterprises पर अनुमान, भुगतान और ऑर्डर ट्रैक कैसे करें।",
  videoLabel: "वीडियो देखें",
  writtenLabel: "स्टेप पढ़ें",
  durationHint: "लगभग 3 मिनट",
  steps: [
    {
      title: "1. रजिस्टर और अप्रूवल",
      body: "होम पेज → साइन अप: मोबाइल, नाम, कंपनी, पता, पिनकोड भरें। मोबाइल ही लॉगिन ID है। साइन अप के बाद TT Enterprises अप्रूव करे — तब लॉगिन करें।",
      tip: "सही मोबाइल नंबर डालें — गलत नंबर पर WhatsApp अपडेट नहीं मिलेंगे।",
    },
    {
      title: "2. लॉगिन",
      body: "होम पर Login टैब → मोबाइल + पासवर्ड। लॉगिन के बाद मूल्य सूची, कैटलॉग, क्विक ऑर्डर, मेरे ऑर्डर, स्कीम, वॉलेट दिखेंगे।",
    },
    {
      title: "3. रेट देखें",
      body: "मूल्य सूची में साइज़×रेट शीट, कैटलॉग में फोटो और स्टॉक। रेट ₹/kg है (बंडल = रेट × वजन)।",
    },
    {
      title: "4. क्विक ऑर्डर",
      body: "प्रोडक्ट → साइज़ → रंग → बंडल चुनें। सबटोटल और शिपिंग तुरंत दिखते हैं। तैयार होने पर Checkout करें।",
      tip: "साइज़×रंग पर स्टॉक खत्म हो तो दूसरा विकल्प चुनें।",
    },
    {
      title: "5. अनुमान भेजें",
      body: "Checkout पर नाम, फोन, ट्रांसपोर्ट, पता, पिनकोड जाँचें। चाहें तो वॉलेट लगाएँ। Place estimate दबाएँ — स्टॉक रिजर्व होता है, यह अंतिम बिल नहीं है।",
    },
    {
      title: "6. स्टेज ट्रैक करें",
      body: "मेरे ऑर्डर → ऑर्डर खोलें। स्टेज: अनुमान → कन्फर्म → बिल/पेमेंट → पेमेंट वेरिफाइड → डिस्पैच → LR → डिलीवर।",
    },
    {
      title: "7. अंतिम बिल का भुगतान",
      body: "एडमिन असली kg से बिल सेव करने के बाद ऑर्डर खोलें। UPI QR या बैंक से भुगतान करें, फिर उसी पेज पर पेमेंट प्रूफ अपलोड करें।",
      tip: "Saved / Final bill (पूरी ₹) चुकाएँ — वजन बदलने पर पुराना अनुमान न देखें।",
    },
    {
      title: "8. LR और डिलीवरी",
      body: "स्टाफ LR नंबर डालते ही ऑर्डर Delivered हो जाता है। LR नंबर और बिल डॉक्यूमेंट ऑर्डर पेज पर रहेंगे।",
    },
    {
      title: "9. स्कीम और वॉलेट",
      body: "स्कीम: असली बिल्ड वजन पर रिवॉर्ड (स्कीम खत्म होने पर)। वॉलेट: जमा/स्कीम क्रेडिट — Checkout पर इस्तेमाल करें।",
    },
  ],
};

const adminEn: HelpGuide = {
  id: "admin",
  title: "Staff & admin how-to guide",
  subtitle:
    "Approve dealers, clear Pending work queues, bill from actual kg, verify payment, and mark delivered with LR.",
  videoLabel: "Watch walkthrough",
  writtenLabel: "Read steps",
  durationHint: "About 4 minutes",
  steps: [
    {
      title: "1. Log in as staff",
      body: "Use your staff mobile + password on the home Login tab. Open Admin from the menu. Your role (sales / accounts / dispatch / owner) controls which screens you see.",
    },
    {
      title: "2. Approve new dealers",
      body: "Admin → Users & roles → Dealers → Pending approval. Approve or Reject. Dealers cannot log in until approved.",
      tip: "Only owner / users permission can manage dealers.",
    },
    {
      title: "3. Use Pending work",
      body: "In the admin sidebar, tap Pending work. It expands into queues: New estimates, Bill pending, Verify payment, LR → delivered, Full truck. Each link opens the filtered Orders list.",
    },
    {
      title: "4. Confirm an estimate",
      body: "Open the order from New estimates. Review lines and customer details. Set status to Confirmed (Update status), or continue straight to final kg if your process skips a separate confirm step.",
    },
    {
      title: "5. Enter actual kg + save bill",
      body: "On the order, Final kg + bill: type actual weight for every line. Bill auto-calculates (rate × kg + shipping). Bill scan PDF is optional. Save final kg & bill — payable is rounded to whole rupees.",
      tip: "Saved bill is the amount the dealer should pay. Check the timeline note matches that figure.",
    },
    {
      title: "6. Verify payment",
      body: "When the dealer uploads proof (or pays offline), open Verify payment queue. Confirm amount, then Verify payment / set Payment verified. Force-verify only when you have confirmed payment outside the app.",
    },
    {
      title: "7. LR → Delivered",
      body: "Enter LR number (file optional). Save LR · mark delivered. Status becomes Delivered. Or use Dispatch only if LR will come later.",
    },
    {
      title: "8. Punch order for a dealer (optional)",
      body: "Admin → Orders → New order: pick dealer, lines, wallet, then create estimate or bill-now. Same rounding rules as dealer checkout.",
    },
    {
      title: "9. Owner-only screens",
      body: "Owner tracking, P/L, balance sheet and purchase rates are owner-only. Staff who open those URLs see Access denied — that is intentional.",
    },
    {
      title: "10. Accounts books (overview)",
      body: "Admin → Accounts opens the books: sales, goods received, money in/out, statements, expenses, reports and Controls. Use Search (Ctrl+K) to find any party, bill or product. See the Books guide below for the full chain.",
      tip: "Open Admin → Help → Books tab for step-by-step books workflow.",
    },
  ],
};

const adminHi: HelpGuide = {
  id: "admin",
  title: "स्टाफ / एडमिन कैसे-करें गाइड",
  subtitle:
    "डीलर अप्रूव, Pending work, असली kg से बिल, पेमेंट वेरिफाई, और LR से Delivered।",
  videoLabel: "वीडियो देखें",
  writtenLabel: "स्टेप पढ़ें",
  durationHint: "लगभग 4 मिनट",
  steps: [
    {
      title: "1. स्टाफ लॉगिन",
      body: "होम Login टैब पर स्टाफ मोबाइल + पासवर्ड। मेनू से Admin खोलें। रोल (sales / accounts / dispatch / owner) से स्क्रीन दिखती हैं।",
    },
    {
      title: "2. नए डीलर अप्रूव",
      body: "एडमिन → Users & roles → Dealers → Pending approval। Approve या Reject। अप्रूव से पहले डीलर लॉगिन नहीं कर सकता।",
      tip: "डीलर मैनेज केवल owner / users अनुमति वाले कर सकते हैं।",
    },
    {
      title: "3. Pending work",
      body: "साइडबार में Pending work दबाएँ — कतारें खुलेंगी: नए अनुमान, बिल बाकी, पेमेंट जाँच, LR → डिलीवर, फुल ट्रक। हर लिंक फ़िल्टर ऑर्डर लिस्ट खोलता है।",
    },
    {
      title: "4. अनुमान कन्फर्म",
      body: "New estimates से ऑर्डर खोलें। लाइन्स और ग्राहक देखें। Update status से Confirmed करें — या सीधे final kg पर जाएँ।",
    },
    {
      title: "5. असली kg + बिल सेव",
      body: "Final kg + bill में हर लाइन का असली वजन डालें। बिल अपने आप (रेट × kg + शिपिंग)। PDF वैकल्पिक। सेव करें — देय राशि पूरी ₹ में गोल होती है।",
      tip: "Saved bill ही डीलर को चुकानी है। टाइमलाइन नोट भी वही आंकड़ा दिखे।",
    },
    {
      title: "6. पेमेंट वेरिफाई",
      body: "Verify payment कतार से ऑर्डर खोलें। राशि जाँचकर Payment verified करें। ऐप के बाहर भुगतान पक्का हो तभी force-verify करें।",
    },
    {
      title: "7. LR → Delivered",
      body: "LR नंबर डालें (फ़ाइल वैकल्पिक)। Save LR · mark delivered — स्टेटस Delivered। बाद में LR आए तो पहले Dispatch only भी हो सकता है।",
    },
    {
      title: "8. डीलर के लिए पंच ऑर्डर",
      body: "एडमिन → Orders → New order: डीलर चुनें, लाइन्स/वॉलेट भरें, अनुमान या तुरंत बिल बनाएँ।",
    },
    {
      title: "9. सिर्फ Owner स्क्रीन",
      body: "Owner tracking, P/L, बैलेंस शीट, खरीद रेट — केवल owner। स्टाफ को Access denied दिखना सही है।",
    },
    {
      title: "10. अकाउंट्स बुक्स",
      body: "Admin → Accounts में किताबें खुलती हैं। Search (Ctrl+K) से पार्टी/बिल/प्रोडक्ट ढूँढें। पूरी श्रृंखला के लिए Help → Books टैब देखें।",
    },
  ],
};

const accountsEn: HelpGuide = {
  id: "accounts",
  title: "Accounts books guide",
  subtitle:
    "Day-to-day books on this site — sales, goods in, money, statements, expenses, and closing controls.",
  videoLabel: "Watch walkthrough",
  writtenLabel: "Read steps",
  durationHint: "About 5 minutes",
  steps: [
    {
      title: "1. Open Accounts Home",
      body: "Admin → Accounts. Big tiles for New sale, Goods received, Money received/paid, Statement, Match statement, Log expense. Cash/bank and queues show at a glance.",
      tip: "Use Search in the Accounts sidebar (or Ctrl+K) anytime.",
    },
    {
      title: "2. New sale",
      body: "Every day → New sale. Pick customer, items, save. Stock moves out and FIFO COGS posts. Dealer orders that get a final bill also auto-create a sale voucher.",
    },
    {
      title: "3. Money received",
      body: "Money received → pick customer, amount, cash or bank. Allocate against open bills so outstanding and aging stay correct.",
    },
    {
      title: "4. Goods received (godown)",
      body: "Staff: Goods received — supplier, qty, packing slip photo. No rates. Stock goes in immediately. Owner later opens Needs pricing to enter rates and post the purchase bill.",
    },
    {
      title: "5. Statement & match",
      body: "Statement shows a party ledger. Match statement: enter their closing balance, tick matching lines, add extras they show that you don’t — until unexplained is zero.",
    },
    {
      title: "6. Opening balances (owner)",
      body: "Set up → Opening balances: opening stock with cost, party openings, old unpaid bills, or CSV from Tally.",
    },
    {
      title: "7. Expenses & journal",
      body: "Log expense: tap Freight / Packing / Electricity / Rent / Other, amount, cash or bank, optional bill photo. Journal is for balanced Dr/Cr adjustments.",
    },
    {
      title: "8. Reports",
      body: "Sales/purchase/profit analysis, stock movements, stock alerts, valuation, cash flow, P&L, balance sheet, trial balance. Owner-only where purchase costs or profit appear.",
    },
    {
      title: "9. Controls",
      body: "Financial year, period lock (blocks posts on or before the lock date), books JSON backup, audit trail, and Health check.",
      tip: "Run Health check after big imports. Use Flow audit under Controls for the full checklist.",
    },
  ],
};

const accountsHi: HelpGuide = {
  id: "accounts",
  title: "अकाउंट्स बुक्स गाइड",
  subtitle:
    "इस साइट पर रोज की किताबें — बिक्री, माल आना, पैसा, स्टेटमेंट, खर्च और कंट्रोल।",
  videoLabel: "वीडियो देखें",
  writtenLabel: "स्टेप पढ़ें",
  durationHint: "लगभग 5 मिनट",
  steps: [
    {
      title: "1. Accounts Home",
      body: "Admin → Accounts। नई बिक्री, माल प्राप्त, पैसा आना/जाना, स्टेटमेंट, मैच, खर्च — बड़े बटन। साइडबार में Search (Ctrl+K) इस्तेमाल करें।",
    },
    {
      title: "2. नई बिक्री",
      body: "ग्राहक और आइटम चुनकर सेव करें। स्टॉक और COGS अपने आप। डीलर बिल सेव होने पर भी सेल वाउचर बनता है।",
    },
    {
      title: "3. पैसा प्राप्त",
      body: "ग्राहक, राशि, कैश/बैंक। खुले बिल पर allocate करें ताकि बकाया सही रहे।",
    },
    {
      title: "4. माल प्राप्त",
      body: "स्टाफ: सप्लायर, मात्रा, पैकिंग स्लिप — रेट नहीं। Owner बाद में Needs pricing में रेट डालकर खरीद बिल पोस्ट करता है।",
    },
    {
      title: "5. स्टेटमेंट और मैच",
      body: "स्टेटमेंट = पार्टी लेजर। Match में उनका क्लोज़िंग डालें, मिलती लाइन्स टिक करें, अंतर शून्य करें।",
    },
    {
      title: "6. ओपनिंग (Owner)",
      body: "Opening balances: स्टॉक+लागत, पार्टी ओपनिंग, पुराने बिल, या Tally CSV।",
    },
    {
      title: "7. खर्च और जर्नल",
      body: "Log expense से एक टैप खर्च। Journal से Dr/Cr एडजस्टमेंट।",
    },
    {
      title: "8. रिपोर्ट्स",
      body: "सेल्स/परचेज़/प्रॉफिट एनालिसिस, स्टॉक मूवमेंट, अलर्ट, वैल्यूएशन, कैश फ्लो, P/L, बैलेंस शीट।",
    },
    {
      title: "9. Controls",
      body: "वित्तीय वर्ष, पीरियड लॉक, बैकअप, ऑडिट ट्रेल, Health check। Flow audit चेकलिस्ट भी Controls में है।",
    },
  ],
};

export function getHelpGuide(
  kind: "dealer" | "admin" | "accounts",
  locale: Locale
): HelpGuide {
  if (kind === "dealer") return locale === "hi" ? dealerHi : dealerEn;
  if (kind === "accounts") return locale === "hi" ? accountsHi : accountsEn;
  return locale === "hi" ? adminHi : adminEn;
}

/** Recording script for real camera / screen videos (EN). */
export const VIDEO_RECORDING_SCRIPTS = {
  dealer: {
    title: "Dealer app — screen recording script (≈3 min)",
    beats: [
      "0:00–0:15 Home page — show Login / Sign up card. Say: Phone is your login.",
      "0:15–0:40 Sign up fields briefly, then cut to approved login.",
      "0:40–1:10 Price List scroll + Catalog one product.",
      "1:10–1:50 Quick Order: add 2 lines, show total.",
      "1:50–2:20 Checkout → Place estimate → land on order page / stages.",
      "2:20–2:50 Pay now section (UPI/bank) + upload proof button.",
      "2:50–3:10 My Orders list. End on logo / contact.",
    ],
  },
  admin: {
    title: "Admin desk — screen recording script (≈4 min)",
    beats: [
      "0:00–0:20 Staff login → Admin desk.",
      "0:20–0:50 Pending work open → New estimates → open order.",
      "0:50–1:20 Confirm status.",
      "1:20–2:20 Enter actual kg, show bill round to whole ₹, Save.",
      "2:20–3:00 Verify payment.",
      "3:00–3:40 LR number → Save LR · mark delivered → stages complete.",
      "3:40–4:00 Show queues back at 0. End.",
    ],
  },
  accounts: {
    title: "Accounts books — screen recording script (≈4 min)",
    beats: [
      "0:00–0:20 Accounts Home tiles + Search (Ctrl+K).",
      "0:20–1:00 New sale → save → show voucher in list.",
      "1:00–1:40 Money received + allocate to bill.",
      "1:40–2:20 Goods received (qty + packing slip) → Needs pricing (owner).",
      "2:20–3:00 Statement / Match statement briefly.",
      "3:00–3:40 Log expense with bill photo.",
      "3:40–4:10 Controls: health check green, mention period lock.",
    ],
  },
} as const;
