import Page from "../components/page"

export default function Charges() {
    return <Page title="Charges">
        <div className="text-center text-2xl font-bold p-1 border my-10">Gig Charges</div>
        <details>
            <summary className="font-bold text-xl text-red-500 cursor-pointer">README FIRST!</summary>
            <div className="flex flex-col gap-3 pl-5">
                <li>I am a student, so I can't work full time on your project.</li>
                <li>I will work on your project in my free time.</li>
                <li>I will try to complete your project as soon as possible.</li>
                <li>I will not work on your project if I am busy with my college work. I will definetly inform you about this beforehand.</li>
                <li>I will not work on your project if I am not interested in it.</li>
                <li>I will not work on your project if it is illegal, unethical or seems fishy.</li>
                <div className="text-xl font-bold mt-10">Finally</div>
                <li>The charges might vary depending on the complexity of the project or effort required during development.</li>
                <li>Contact and discuss for a better understanding of the project and the charges.</li>
                <li>API keys, tokens, etc. will have to be provided by the client. (Will guide how to create if needed)</li>
                <li>I will not bear any extra charges like hosting, domain, etc. These will have to be paid for and provided by the client.</li>
                <li>Once the project is done, I will handover the Code, Credentials, Github Repo, etc. to the client.</li>
                <li>I will not be responsible for any bugs or issues in the code after the project is handed over.</li>
                <li>I will not be responsible for any issues caused by the project after the project is handed over.</li>
                <div className="text-xl font-bold mt-10">Accepted payment methods:</div>
                <li>UPI / Bank Transfer (India only)</li>
                <li>PayPal (International)</li>
                <li>Crypto (equivalent amount in USDT, USDC etc.)</li>
                <div>For payment in currencies other than USD, the amount shall be converted to INR using the current exchange rate.</div>
                <br />
                <div className="font-bold">✨ I can work on projects with custom requirements too. Contact me and get a quote ✨</div>
                <div>For queries or quotes contact on <a href="mailto:ankush4singh@gmail.com" className="text-[#78e2a0] hover:bg-[#78e2a0] hover:text-black p-1">ankush2singh@gmail.com</a></div>
            </div>
        </details>
    </Page>
}