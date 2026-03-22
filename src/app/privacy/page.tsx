import Link from "next/link";

const textStyle: React.CSSProperties = { fontFamily: "Helvetica, Arial, sans-serif", fontWeight: 700, color: "#000" };

export default function PrivacyPage() {
  return (
    <main className="min-h-screen p-6 sm:p-12" style={{ background: "#fff" }}>
      <div className="max-w-[700px] mx-auto flex flex-col gap-8">
        <Link href="/" className="text-[10px] uppercase tracking-wider" style={{ ...textStyle, fontSize: "10px" }}>
          BACK
        </Link>

        <h1 className="text-2xl tracking-[2px] uppercase" style={textStyle}>PRIVACY POLICY</h1>

        <div className="flex flex-col gap-4 text-[12px] leading-relaxed" style={{ ...textStyle, fontSize: "12px", fontWeight: 400 }}>
          <p>LAST UPDATED: MARCH 22, 2026</p>

          <p>THIS PRIVACY POLICY DESCRIBES HOW SLOWEDANDREVERBED.COM (&ldquo;THE SERVICE&rdquo;) HANDLES YOUR INFORMATION.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>1. INFORMATION WE COLLECT</h2>
          <p>WE COLLECT MINIMAL INFORMATION NECESSARY TO PROVIDE THE SERVICE. THIS MAY INCLUDE AUDIO FILES YOU UPLOAD FOR PROCESSING, METADATA ASSOCIATED WITH YOUR EXPORTS (ARTIST NAME, TRACK TITLE), AND STANDARD WEB SERVER LOGS (IP ADDRESS, BROWSER TYPE, ACCESS TIMES).</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>2. HOW WE USE INFORMATION</h2>
          <p>YOUR INFORMATION IS USED SOLELY TO PROVIDE AND IMPROVE THE SERVICE. WE DO NOT SELL, RENT, OR SHARE YOUR PERSONAL INFORMATION WITH THIRD PARTIES FOR MARKETING PURPOSES.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>3. THIRD-PARTY SERVICES</h2>
          <p>THE SERVICE USES THIRD-PARTY PROVIDERS FOR HOSTING, FILE STORAGE, AND SOCIAL MEDIA INTEGRATION (INCLUDING YOUTUBE AND TIKTOK). THESE PROVIDERS MAY COLLECT INFORMATION ACCORDING TO THEIR OWN PRIVACY POLICIES. WE ENCOURAGE YOU TO REVIEW THEIR POLICIES.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>4. DATA RETENTION</h2>
          <p>UPLOADED AUDIO FILES ARE PROCESSED AND MAY BE TEMPORARILY STORED FOR THE DURATION OF YOUR SESSION. EXPORTED CONTENT IS STORED ON THIRD-PARTY HOSTING SERVICES. YOU MAY REQUEST DELETION OF YOUR CONTENT AT ANY TIME.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>5. COOKIES</h2>
          <p>THE SERVICE MAY USE ESSENTIAL COOKIES FOR FUNCTIONALITY. WE DO NOT USE TRACKING OR ADVERTISING COOKIES.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>6. SECURITY</h2>
          <p>WE TAKE REASONABLE MEASURES TO PROTECT YOUR INFORMATION. HOWEVER, NO METHOD OF TRANSMISSION OVER THE INTERNET IS 100% SECURE.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>7. CHILDREN</h2>
          <p>THE SERVICE IS NOT DIRECTED AT CHILDREN UNDER 13. WE DO NOT KNOWINGLY COLLECT INFORMATION FROM CHILDREN UNDER 13.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>8. CHANGES</h2>
          <p>WE MAY UPDATE THIS POLICY FROM TIME TO TIME. CHANGES WILL BE POSTED ON THIS PAGE WITH AN UPDATED DATE.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>9. CONTACT</h2>
          <p>FOR QUESTIONS ABOUT THIS PRIVACY POLICY, CONTACT US THROUGH THE WEBSITE.</p>
        </div>
      </div>
    </main>
  );
}
