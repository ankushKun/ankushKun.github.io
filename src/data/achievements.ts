// import hackerhouseTweet from "../assets/certificates/achievement/hackerhouse-tweet.png";
// import gconVegathon23 from "../assets/certificates/achievement/gcon-vegathon-23.jpg";
// import hackocto1 from "../assets/certificates/achievement/hackocto-1.jpg";
// import hashitout1 from "../assets/certificates/achievement/hashitout-1.jpg";
// import hashitout2 from "../assets/certificates/achievement/hashitout-2.jpg";
// import nh2 from "../assets/certificates/achievement/nh-2.jpg";
// import supportathon from "../assets/certificates/achievement/supportathon.jpg";
// import wmd from "../assets/certificates/achievement/wemakedevs.jpg";
// import icp from "../assets/certificates/achievement/crewsphere-icp.jpg";

// import lfgho24 from "../assets/certificates/participation/lfgho24.jpg";
// import ethonline23 from "../assets/certificates/participation/ethonline23.jpg";
// import awscd from "../assets/certificates/participation/aws-cd-2022.jpg";
// import bcPhoto from "../assets/certificates/participation/british-council-photography.jpg";
// import cpWorkshop from "../assets/certificates/participation/cp-workshop-2022.jpg";
// import cubecomp from "../assets/certificates/participation/cubecomp-2017.jpg";
// import gconAppreciation from "../assets/certificates/participation/gcon-appreciation.jpg";
// import gconParticipation from "../assets/certificates/participation/gcon-participation.jpg";
// import hacknsut from "../assets/certificates/participation/hacknsut-2023.jpg";
// import hackocto1Participation from "../assets/certificates/participation/hackocto-1.jpg";
// import hashitout1cc from "../assets/certificates/participation/hashitout-1-cc.jpg";
// import hashitout1Participation from "../assets/certificates/participation/hashitout-1.jpg";
// import htm3 from "../assets/certificates/participation/htm-3.jpg";
// import icHack from "../assets/certificates/participation/ic-hack-2022.jpg";
// import icpWorkshop from "../assets/certificates/participation/icp-workshop.jpg";
// import iitrOneapi from "../assets/certificates/participation/iitr-oneapi.jpg";
// import mitAppinventor from "../assets/certificates/participation/mit-appinventor.jpg";
// import sheBuilds from "../assets/certificates/participation/she-builds.jpg";
// import sihTekathon2 from "../assets/certificates/participation/sih-tekathon-2.jpg";
// import tinkerfest2019 from "../assets/certificates/participation/tinkerfest-2019.jpg";

// import votePaper from "../assets/certificates/publishing/ijset-votekick.png";
import { StaticImageData } from "next/image";

type CertItemType = {
    title: string;
    image?: StaticImageData;
    position?: string;
    year: number;
    link?: string;
};

const publishingCerts: CertItemType[] = [
    {
        title: "IJSET Paper: Implementing a Vote kick System in Video Games Through Blockchain Technology",
        // image: votePaper,
        year: 2021,
    },
];

const achieveCerts: CertItemType[] = [
    {
        title: "Arweave India Cohort #1 hackerhouse",
        year: 2023,
        position: "🥇 Grand Prize",
        link: "https://x.com/arweaveindia/status/1734972911163961371"
        // image: hackerhouseTweet,
    },
    {
        title: "Crewsphere ICP College level hackathon",
        year: 2023,
        position: "🥈 Second"
        // image: icp,
    },
    {
        title: "Hack-O-Octo 1.0",
        year: 2023,
        position: "🥈 Second"
        // image: hackocto1,
    },
    {
        title: "CDAC's GCON Vegathon",
        year: 2023,
        position: "🥇 First"
        // image: gconVegathon23,
    },
    {
        title: "SheBuilds Hackathon",
        year: 2023,
        position: "🏅 Track Prize",
        link: "https://devfolio.co/projects/pokemonzilla-c051"
    },
    {
        title: "Hash It Out 1.0",
        year: 2022,
        position: "🥈 Second"
        // image: hashitout1,
    },
    // {
    //     title: "Hash It Out 2.0",
    //     year: 2022,
    //     position: "🥈 Second"
    //     // image: hashitout2,
    // },
    {
        title: "Neighbourhood Hacks 2.0",
        year: 2022,
        position: "🏅 Track Prize"
        // image: nh2,
    },
    {
        title: "Support-a-thon",
        year: 2022,
        position: "🏅 Track Prize"
        // image: supportathon,
    },
    {
        title: "We Make Devs <> Stream hackathon",
        year: 2022,
        position: "🏅 Track Prize"
        // image: wmd,
    },
];

const participCerts: CertItemType[] = [
    {
        title: "LFGHO 2024",
        year: 2024,
        // image: lfgho24,
    },
    {
        title: "NASA CanSat '24 (cleared PDR round | Built a prototype sat)",
        year: 2023,
    },
    {
        title: "EthOnline 2023",
        year: 2023,
        // image: ethonline23,
    },
    {
        title: "ICP Workshop",
        year: 2023,
        // image: icpWorkshop,
    },
    {
        title: "SIH Tekathon 2.0",
        year: 2023,
        // image: sihTekathon2,
    },
    {
        title: "Hack-O-Octo 1.0",
        year: 2023,
        // image: hackocto1Participation,
    },
    {
        title: "GCON Vegathon '23",
        year: 2023,
        // image: gconParticipation,
    },
    // {
    //     title: "GCON Vegathon Appreciation - 2023",
    //     year: 2023,
    //     // image: gconAppreciation,
    // },
    {
        title: "IIT Roorkee Intel OneAPI workshop + hackathon",
        year: 2023,
        // image: iitrOneapi,
    },
    {
        title: "HackNSUT '23",
        year: 2023,
        // image: hacknsut,
    },
    {
        title: "SheBuilds",
        year: 2023,
        // image: sheBuilds,
    },
    {
        title: "Hash-It-Out",
        year: 2022,
        // image: hashitout1Participation,
    },
    // {
    //     title: "Hash-It-Out CodeChef - 2022",
    //     year: 2022,
    //     // image: hashitout1cc,
    // },
    {
        title: "AWS Commnuity Day Quizes",
        year: 2022,
        // image: awscd,
    },
    {
        title: "Hack The Mountains 3.0",
        year: 2022,
        // image: htm3,
    },
    {
        title: "IC Hack '22",
        year: 2022,
        // image: icHack,
    },
    {
        title: "Tinkerfest Junior Robotice competition",
        year: 2019,
        // image: tinkerfest2019,
    },
    {
        title: "MIT Appinventor hackathon",
        year: 2019,
        // image: mitAppinventor,
    },
    {
        title: "City of Joy CubeComp",
        year: 2017,
        // image: cubecomp,
    },
    {
        title: "British Council Photography Workshop",
        year: 2013,
        // image: bcPhoto,
    },
];

export { achieveCerts, participCerts, publishingCerts };
export type { CertItemType };
