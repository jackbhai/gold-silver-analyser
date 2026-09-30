# Groq Proxy Setup — 5 minute, free

Tumhari Groq key ko **server-side** chhupane ke liye. Key kabhi app ke
public code me nahi aayegi.

## Steps

1. **Cloudflare account** banao (free): https://dash.cloudflare.com/sign-up
2. Dashboard → **Workers & Pages** → **Create** → **Create Worker** → **Deploy** dabao (sample code se matlab nahi)
3. Worker khol ke **Edit Code** → yahan `worker/groq-proxy.js` ka poora code paste karo → **Save and Deploy**
4. Worker page pe **Settings** → **Variables and Secrets** →
   - **Add secret**: naam `GROQ_API_KEY`, value me apni Groq key (`gsk_…` wali, 10 me se koi 1) → Save
   - **Add secret**: naam `PROXY_SECRET`, value me koi lamba random password khud bana ke dalo (jaise `Pranshu-Bullion-9xK2…`) → Save
   - (Optional) **Add variable**: naam `ALLOWED_ORIGIN`, value `https://jackbhai.github.io` — sirf tumhari site se calls aayengi
5. **Deploy** dobara dabao (secret lagne ke baad zaroori)
6. Worker ka URL copy karo — kuch aisa dikhega: `https://bullion-groq-proxy.tumhara-name.workers.dev`

## App me jodna

1. BullionAI app kholo → **AI MARKET ANALYST** section
2. **Worker Proxy** wale box me:
   - Proxy URL paste karo (upar wala workers.dev URL)
   - Proxy Secret dalo (wohi jo step 4 me banaya tha)
   - **Save** dabao
3. Ab **AI Outlook Generate Karo** dabao — key maange bina kaam karega, kyunki key worker ke andar safe hai.

## Notes

- Dono secrets **sirf Cloudflare ke andar** rehte hain — GitHub pe, app me, kahin public nahi.
- Proxy secret ke bina koi bahar ka banda tumhara worker use karke quota nahi uda sakta.
- Free Worker limits: 100,000 requests/day — AI outlook ke liye bahut zyada hai.
- Key kabhi khatam/rotate karni ho to sirf Cloudflare secret update karo, app chhoone ki zaroorat nahi.
