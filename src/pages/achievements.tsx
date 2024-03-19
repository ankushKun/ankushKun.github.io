import Page from "../components/page";
import {
  achieveCerts,
  participCerts,
  publishingCerts,
  CertItemType,
} from "../data/cert";

const CertItem = (item: CertItemType) => {
  return (
    <div className="my-10">
      <div className="mb-3 text-center text-2xl font-bold">{item.title}</div>
      <img
        src={item.image}
        alt={item.title}
        className="mx-auto block rounded-lg object-contain sm:max-w-[70%]"
      />
    </div>
  );
};

export default function Certificates() {
  return (
    <Page title="Achievements & Certificates">
      <div className="my-10 border p-1 text-center text-2xl font-bold">
        Achievements & Certificates
      </div>

      <details open className="my-10">
        <summary className="cursor-pointer">
          {publishingCerts.length} Publications 📚{" "}
        </summary>
        {publishingCerts.map((item: CertItemType, _: number) => {
          return <CertItem key={_} {...item} />;
        })}
      </details>

      <details open className="my-10">
        <summary className="cursor-pointer">
          {achieveCerts.length} Achievements 🎉{" "}
        </summary>
        {achieveCerts.map((item: CertItemType, _: number) => {
          return <CertItem key={_} {...item} />;
        })}
      </details>

      <details className="my-10">
        <summary className="cursor-pointer">
          {participCerts.length} Participations 💫{" "}
        </summary>
        {participCerts.map((item: CertItemType, _: number) => {
          return <CertItem key={_} {...item} />;
        })}
      </details>
    </Page>
  );
}
