import Page from "../components/page"
import { achieveCerts, participCerts, CertItemType } from "../data/cert"


const CertItem = (item: CertItemType) => {
    return <div className="my-10">
        <div className="text-2xl font-bold text-center mb-3">{item.title}</div>
        <img src={item.image} alt={item.title} className="object-contain mx-auto sm:max-w-[70%] block rounded-lg" />
    </div>
}

export default function Certificates() {


    return <Page title="Achievements & Certificates">
        <div className="text-center text-2xl font-bold p-1 border my-10">Achievements & Certificates</div>

        <details open className="my-10">
            <summary className="cursor-pointer">{achieveCerts.length} Achievements 🎉 </summary>
            {
                achieveCerts.map((item: CertItemType, _: number) => {
                    return <CertItem key={_} {...item} />
                })
            }
        </details>

        <details className="my-10">
            <summary className="cursor-pointer">{participCerts.length} Participations 💫 </summary>
            {
                participCerts.map((item: CertItemType, _: number) => {
                    return <CertItem key={_} {...item} />
                })
            }
        </details>

    </Page>
}