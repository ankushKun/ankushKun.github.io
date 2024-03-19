import gconVegathon23 from "../assets/certificates/achievement/gcon-vegathon-23.jpg";
import hackocto1 from "../assets/certificates/achievement/hackocto-1.jpg";
import hashitout1 from "../assets/certificates/achievement/hashitout-1.jpg";
import hashitout2 from "../assets/certificates/achievement/hashitout-2.jpg";
import nh2 from "../assets/certificates/achievement/nh-2.jpg";
import supportathon from "../assets/certificates/achievement/supportathon.jpg";
import wmd from "../assets/certificates/achievement/wemakedevs.jpg";
import icp from "../assets/certificates/achievement/crewsphere-icp.jpg";

import ethonline23 from "../assets/certificates/participation/ethonline23.jpg";
import awscd from "../assets/certificates/participation/aws-cd-2022.jpg";
import bcPhoto from "../assets/certificates/participation/british-council-photography.jpg";
import cpWorkshop from "../assets/certificates/participation/cp-workshop-2022.jpg";
import cubecomp from "../assets/certificates/participation/cubecomp-2017.jpg";
import gconAppreciation from "../assets/certificates/participation/gcon-appreciation.jpg";
import gconParticipation from "../assets/certificates/participation/gcon-participation.jpg";
import hacknsut from "../assets/certificates/participation/hacknsut-2023.jpg";
import hackocto1Participation from "../assets/certificates/participation/hackocto-1.jpg";
import hashitout1cc from "../assets/certificates/participation/hashitout-1-cc.jpg";
import hashitout1Participation from "../assets/certificates/participation/hashitout-1.jpg";
import htm3 from "../assets/certificates/participation/htm-3.jpg";
import icHack from "../assets/certificates/participation/ic-hack-2022.jpg";
import icpWorkshop from "../assets/certificates/participation/icp-workshop.jpg";
import iitrOneapi from "../assets/certificates/participation/iitr-oneapi.jpg";
import mitAppinventor from "../assets/certificates/participation/mit-appinventor.jpg";
import sheBuilds from "../assets/certificates/participation/she-builds.jpg";
import sihTekathon2 from "../assets/certificates/participation/sih-tekathon-2.jpg";
import tinkerfest2019 from "../assets/certificates/participation/tinkerfest-2019.jpg";

import votePaper from "../assets/certificates/publishing/ijset-votekick.png";

type CertItemType = {
  title: string;
  image: typeof gconVegathon23;
};

const publishingCerts: CertItemType[] = [
  {
    title:
      "IJSET Paper: Implementing a Vote kick System in Video Games Through Blockchain Technology",
    image: votePaper,
  },
];

const achieveCerts: CertItemType[] = [
  {
    title: "🥇 Grand Prize - Arweave India Cohort #1 hackerhouse - 2023",
    image:
      "https://media.discordapp.net/attachments/952560619264020510/1184744702491242526/tweet-1734972911163961371_1.png",
  },
  {
    title: "🥈 Crewsphere ICP College level hackathon",
    image: icp,
  },
  {
    title: "🥈 2nd  - Hack-O-Octo 1.0 - 2023",
    image: hackocto1,
  },
  {
    title: "🥇 First  - GCON Vegathon - 2023",
    image: gconVegathon23,
  },
  {
    title: "🥈 Second  - Hash It Out 1.0 - 2022",
    image: hashitout1,
  },
  {
    title: "🥈 Second - Hash It Out 2.0 - 2022",
    image: hashitout2,
  },
  {
    title: "🏅 Track Prize - Neighbourhood Hacks 2.0 - 2022",
    image: nh2,
  },
  {
    title: "🏅 Track Prize - Support-a-thon - 2022",
    image: supportathon,
  },
  {
    title: "🏅 Track Prize - We Make Devs <> Stream hackathon - 2022",
    image: wmd,
  },
];

const participCerts: CertItemType[] = [
  {
    title: "EthOnline 2023",
    image: ethonline23,
  },
  {
    title: "ICP Workshop - 2023",
    image: icpWorkshop,
  },
  {
    title: "SIH Tekathon 2.0 - 2023",
    image: sihTekathon2,
  },
  {
    title: "Hack-O-Octo 1.0 - 2023",
    image: hackocto1Participation,
  },
  {
    title: "GCON Vegathon - 2023",
    image: gconParticipation,
  },
  {
    title: "GCON Vegathon Appreciation - 2023",
    image: gconAppreciation,
  },
  {
    title: "IIT Roorkee OneAPI - 2023",
    image: iitrOneapi,
  },
  {
    title: "HackNSUT - 2023",
    image: hacknsut,
  },
  {
    title: "SheBuilds - 2023",
    image: sheBuilds,
  },
  {
    title: "Hash-It-Out - 2022",
    image: hashitout1Participation,
  },
  {
    title: "Hash-It-Out CodeChef - 2022",
    image: hashitout1cc,
  },
  {
    title: "AWS Commnuity Day Quiz- 2022",
    image: awscd,
  },
  {
    title: "Hack The Mountains 3.0 - 2022",
    image: htm3,
  },
  {
    title: "CP Workshop - 2022",
    image: cpWorkshop,
  },
  {
    title: "IC Hack - 2022",
    image: icHack,
  },
  {
    title: "Tinkerfest - 2019",
    image: tinkerfest2019,
  },
  {
    title: "MIT Appinventor hackathon",
    image: mitAppinventor,
  },
  {
    title: "City of Joy CubeComp - 2017",
    image: cubecomp,
  },
  {
    title: "British Council Photography Workshop - 2013",
    image: bcPhoto,
  },
];

export { achieveCerts, participCerts, publishingCerts };
export type { CertItemType };
