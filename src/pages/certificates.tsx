import Page from "../components/page"
import { achieveCerts, participCerts, CertItemType } from "../data/cert"


const CertItem = (item: CertItemType) => {
    return <div className="my-5">
        <div className="text-xl text-center mb-1">{item.title}</div>
        <img src={item.image} alt={item.title} className="object-contain mx-auto sm:max-w-[70%] block" />
    </div>
}

export default function Certificates() {


    return <Page title="Certificates">
        <div className="text-center text-2xl font-bold p-1 border my-10">Certificates</div>

        <details open className="my-10">
            <summary className="cursor-pointer">{achieveCerts.length} Achievements 🎉 </summary>
            {
                achieveCerts.map((item: CertItemType, _: number) => {
                    return <CertItem key={_} {...item} />
                })
            }
        </details>

        <details open className="my-10">
            <summary className="cursor-pointer">{participCerts.length} Participations 💫 </summary>
            {
                participCerts.map((item: CertItemType, _: number) => {
                    return <CertItem key={_} {...item} />
                })
            }
        </details>

    </Page>
}