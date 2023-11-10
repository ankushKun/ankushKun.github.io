import Page from "./components/page"
import pfp from "./assets/nihon.png"
import Link from "./components/link"

export default function Home() {
  return <Page title="Ankush Singh">
    <div className="text-center mt-10">
      <img src={pfp} alt="nihon" width={200} className="mx-auto" />
      <div className="text-2xl my-4">Hi, I am Ankush Singh 👋</div>
      <div className="flex flex-col gap-7">
        <div>🎓 University Sophomore</div>
        <div>💻 Freelance Developer</div>
        <div>🧑‍💻 Web3 lead at GeeXpro Society</div>
        <div>🧑‍💻 Ex-Developer Intern at Physics Wallah</div>
        <div className="w-fit mx-auto flex gap-4 justify-evenly">
          <Link url="/resume" text="view resume" />
          <Link url="/resume" text="view projects" />
        </div>
      </div>
    </div>
  </Page>
}
