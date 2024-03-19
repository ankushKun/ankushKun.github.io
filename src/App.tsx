import Page from "./components/page";
// import pfp from "./assets/nihon.png";
import pfp from "./assets/ankush.png";
import Link from "./components/link";

export default function Home() {
  return (
    <Page title="Ankush Singh">
      <div className="mt-10 text-center">
        <img src={pfp} alt="nihon" width={250} className="mx-auto rounded-lg" />
        <div className="my-4 text-2xl">Hi, I am Ankush Singh 👋</div>
        <div className="flex flex-col gap-7">
          <div>
            🧑‍💻 Building{" "}
            <a
              href="https://betteridea.dev"
              target="_blank"
              className="text-green-300 underline underline-offset-4"
            >
              BetterIDEa
            </a>
          </div>
          <div>🎓 University Sophomore</div>
          <div>💻 Freelance Developer</div>
          <div>🏆️ Arweave India Hackerhouse '23 winner</div>
          <div>🧑‍💻 Ex-Developer Intern @ Physics Wallah</div>
          <div className="mx-auto flex w-fit flex-col justify-evenly gap-4 md:flex-row">
            <Link
              url="https://ankushKun.github.io/resume.pdf"
              text="View Resume"
              newTab
            />
            <Link url="/projects" text="Checkout Projects" />
            <Link url="/timeline" text="My Events & Experiences" />
          </div>
        </div>
      </div>
    </Page>
  );
}
