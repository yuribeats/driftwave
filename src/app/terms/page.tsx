import Link from "next/link";

const textStyle: React.CSSProperties = { fontFamily: "Helvetica, Arial, sans-serif", fontWeight: 700, color: "#000" };

export default function TermsPage() {
  return (
    <main className="min-h-screen p-6 sm:p-12" style={{ background: "#fff" }}>
      <div className="max-w-[700px] mx-auto flex flex-col gap-8">
        <Link href="/" className="text-[10px] uppercase tracking-wider" style={{ ...textStyle, fontSize: "10px" }}>
          BACK
        </Link>

        <h1 className="text-2xl tracking-[2px] uppercase" style={textStyle}>TERMS OF SERVICE</h1>

        <div className="flex flex-col gap-4 text-[12px] leading-relaxed" style={{ ...textStyle, fontSize: "12px", fontWeight: 400 }}>
          <p>LAST UPDATED: MARCH 22, 2026</p>

          <p>BY USING SLOWEDANDREVERBED.COM (&ldquo;THE SERVICE&rdquo;), YOU AGREE TO THESE TERMS. IF YOU DO NOT AGREE, DO NOT USE THE SERVICE.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>1. USE OF SERVICE</h2>
          <p>THE SERVICE PROVIDES AUDIO PROCESSING TOOLS FOR PERSONAL AND CREATIVE USE. YOU MAY USE THE SERVICE TO PROCESS AUDIO FILES YOU HAVE THE RIGHT TO USE. YOU ARE SOLELY RESPONSIBLE FOR ANY CONTENT YOU UPLOAD, PROCESS, OR DISTRIBUTE USING THE SERVICE.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>2. USER CONTENT</h2>
          <p>YOU RETAIN ALL RIGHTS TO CONTENT YOU UPLOAD. BY USING THE SERVICE, YOU GRANT US A LIMITED LICENSE TO PROCESS YOUR CONTENT SOLELY FOR THE PURPOSE OF PROVIDING THE SERVICE. WE DO NOT CLAIM OWNERSHIP OF YOUR CONTENT.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>3. PROHIBITED USE</h2>
          <p>YOU MAY NOT USE THE SERVICE TO PROCESS CONTENT YOU DO NOT HAVE RIGHTS TO, ENGAGE IN ANY ILLEGAL ACTIVITY, ATTEMPT TO DISRUPT OR COMPROMISE THE SERVICE, OR REDISTRIBUTE THE SERVICE ITSELF.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>4. THIRD-PARTY SERVICES</h2>
          <p>THE SERVICE MAY INTEGRATE WITH THIRD-PARTY PLATFORMS INCLUDING YOUTUBE AND TIKTOK. YOUR USE OF THOSE PLATFORMS IS GOVERNED BY THEIR RESPECTIVE TERMS OF SERVICE. WE ARE NOT RESPONSIBLE FOR THIRD-PARTY SERVICES.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>5. DISCLAIMER</h2>
          <p>THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE DO NOT GUARANTEE UNINTERRUPTED OR ERROR-FREE OPERATION.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>6. LIMITATION OF LIABILITY</h2>
          <p>TO THE FULLEST EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING FROM YOUR USE OF THE SERVICE.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>7. CHANGES</h2>
          <p>WE RESERVE THE RIGHT TO MODIFY THESE TERMS AT ANY TIME. CONTINUED USE OF THE SERVICE CONSTITUTES ACCEPTANCE OF UPDATED TERMS.</p>

          <h2 className="text-[14px] mt-4" style={{ ...textStyle, fontSize: "14px" }}>8. CONTACT</h2>
          <p>FOR QUESTIONS ABOUT THESE TERMS, CONTACT US THROUGH THE WEBSITE.</p>
        </div>
      </div>
    </main>
  );
}
