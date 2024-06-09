import { StaticImport } from "next/dist/shared/lib/get-img-props"

export type TBlog = {
    title: string,
    description?: string,
    tags: string[],
    link: string,
    date: string,
    image?: StaticImport | string
}

export const blogs: TBlog[] = [
    {
        title: "Writing unit tests for your AO processes using the Test module",
        tags: ["AO", "Unit Testing", "Arweave"],
        link: "https://mirror.xyz/0xCf673b87aFBed6091617331cC895376209d3b923/uBgGB-HNhlig7RucAzdSyRjJIJSXCug5NMgN7bXS9qk",
        date: "02-06-2024",
        image:"https://images.mirror-media.xyz/nft/VgkojTvsQE8urH24sHs2P.png"
    },
    {
        title: "Automating Mandelbrot Fractal generation with SYCL Programming",
        tags: ["SYCL", "Fractals", "C++"],
        link: "https://medium.com/@ankushkun/automating-mandelbrot-fractal-generation-with-sycl-programming-22da4a89e012",
        date: "30-03-2024",
        image:"https://miro.medium.com/v2/resize:fit:720/format:webp/1*HiYIE_ehe_7jpMEYs9meew.jpeg"
    }
]