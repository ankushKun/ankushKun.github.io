+++
date = '2023-03-30'
draft = false
title = 'Automating Mandelbrot Fractal generation with SYCL Programming'
description = "Step-by-step guide to automate npm package publishing through GitHub Actions using OpenID Connect (OIDC). Set up trusted publishing without API keys or access tokens for secure, provenance-verified releases."
summary = 'Learn how to automate npm package publishing through GitHub Actions using OpenID Connect (OIDC) - no API keys or access tokens required.'
tags = ['SYCL', 'Mandelbrot', 'Intel OneAPI']
author = 'Ankush'
+++

# What’s this about?

I had recently attended a workshop by Intel on their oneAPI programming model which was conducted by [Abhishek Nandy](https://medium.com/u/af7b551ddcdb) at IIT Roorkee during the Cognizance 2023. I attended this workshop with my friend, [Krish Agrawal](https://medium.com/@kragrrr), who is also the co-author of this blog.  
The workshop was held for 2 days in which Nandy Sir on the first day told about this new model by **Intel** and how to get started with its implementation with the help of **JupyterLab**. Before ending the day, we were told that there will be a hackathon where he will take implementations of the this new model by all the students in the form of teams as to how we use Intel oneAPI in real-life projects.

**SYCL (/sɪkl/)** is a programming model for high-performance computing that allows developers to write code for heterogeneous systems that use accelerators such as GPUs, FPGAs, and other specialised processing units. It is an open standard developed by the Khronos Group, an industry consortium that also develops other widely used graphics and compute APIs such as OpenGL and Vulkan. SYCL code can be executed on a variety of devices, including CPUs, GPUs, and FPGAs, without modification.

![Mandelbrot fractal](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*HiYIE_ehe_7jpMEYs9meew.jpeg)

**Fractals** are fascinating geometric shapes that repeat themselves infinitely on different scales. They are created through a process of **repeating a simple mathematical equation** or algorithm to form increasingly intricate patterns. These fractal shapes are naturally occurring and can be observed in many aspects of nature, such as the patterns of a fern leaf, the coastlines of continents, and even the formation of clouds. One of the most well-known and captivating fractals is the **Mandelbrot fractal**. This type of fractal is generated through an iterative process using complex numbers, resulting in a shape that is renowned for its intricate detail and infinite complexity. It’s a true marvel of mathematics!

Now that we know what our project revolves around, let’s see its implementation in JupyterLab.

# Getting started on DevCloud

DevCloud is sandbox that intel provides to learn and try out their oneAPI ecosystem. We will be using the devcloud jupyter lab to run our SYCL fractal generation project. It is way easier and quicker to run SYCL projects on the sandbox than on your local machine.

So head over to https://devcloud.intel.com/oneapi/ and create an account. Navigate to the 'Getting Started' tab, scroll down to 'Connect with JupyterLab' and Launch a JupyterLab instance. It might take some time or get loaded instantly depending on the server load so have some patience.

![Devcloud Jupyterlab](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*8JUHbOpbnWCiTXeLqpqEPQ.png)

Once launched, you will find a bunch of folders in the file explorer, including a `mandelbrot` folder.

Open the Terminal from the landing page, cd into the `mandelbrot` directory and run the build script.

```bash
cd mandelbrot
chmod +x build.sh
./build.sh
```

![Build results](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*62IvxnuK0M2Maf3cG43Cjw.png)

This will compile and run the project and create a `mandelbrot.png` file inside the `build` folder. As you can see the image is 1024x1024 pixels and it took just 190 milliseconds to generate the image (serial time + parallel time). If we were to do the same in python or regular C++ without SYCL, it would take seconds to generate the same result. So that’s the power of SYCL.

If you checkout the `src/mandel.hpp` file, you can find 4 variables row and column size, max iterations and repetitions. We can modify these values to generate Mandelbrot sets of different resolutions and qualities.

Try changing these values and see how much time it takes for the images of different configurations to generate.

# Automate it

Let’s now write a **bash script** that automatically changes the values in the C++ file and builds the project.

Create a file `autogen.sh` and inside it write the following lines.

```bash
#!/bin/bash

PASSES=(10 100 500 1000 5000)
SIZES=(1024 2048 4096 8192 16384)

EDIT_FILE="src/mandel.hpp"
BUILD_FILE="build.sh"

prev_size=100
prev_pass=100
let count=0
```

The variable `PASSES` contains a list of iterations that will be used in each image of the image generated and sizes contains the list of resolutions for the images in pixels. `prev_size` and `prev_pass` is a placeholder that we will use later. `count` is the number of images generated.


```bash
for SIZE in ${SIZES[@]}; do
    for PASS in ${PASSES[@]}; do
        echo ""
        echo "Generating fractal for $SIZE x $SIZE with $PASS passes"
        echo ""

        ...

    done
done
```

We create a nested loop for the values of `SIZES` and `PASSES`, so we can have all the combinations of sizes and passes to generate the images with. In the body of the loop we print a message to display to the user.

In order to edit the values of the 3 variables in the `mandel.hpp` file we will use the `sed` command.

```bash
sed -ie "s/row_size=$prev_size/row_size=$SIZE/g" $EDIT_FILE
sed -ie "s/col_size=$prev_size/col_size=$SIZE/g" $EDIT_FILE
sed -ie "s/max_iterations=$prev_pass/max_iterations=$PASS/g" $EDIT_FILE
sed -ie "s/repetitions=$prev_pass/repetitions=$PASS/g" $EDIT_FILE

prev_size=$SIZE
prev_pass=$PASS
count=$((count+1))
```

This uses find and replace to replace the previous values of the variables with new values and updates the count in each iteration of the bash loop.

To run the build command we simply do

```bash
./$BUILD_FILE

echo ""
echo "Generated for $SIZE x $SIZE with $PASS passes"
echo ""
```

The project is built and image is saved in the build folder, so we will have to copy it from there into a location of our choice. Create a folder images in the mandelbrot folder and add the following copy command to the `autogen.sh` script

```bash
cp "./build/mandelbrot.png" "./images/$count.mandelbrot_${SIZE}_${PASS}.png"
```

This copies the image from build into images folder and also renames it to contain useful information such as size and number of passes and the count.

Run the autogen script and let the fractals be created!

```bash
chmod +x autogen.sh
./autogen.sh
```

After the script is done, you will find the images in the images folder.

Here is the full autogen script

```bash
#!/bin/bash

PASSES=(10 100 500 1000 5000)
SIZES=(1024 2048 4096 8192 16384)

EDIT_FILE="src/mandel.hpp"
BUILD_FILE="build.sh"

prev_size=100
prev_pass=100
let count=0

for SIZE in ${SIZES[@]}; do
    for PASS in ${PASSES[@]}; do
        echo ""
        echo "Generating fractal for $SIZE x $SIZE with $PASS passes"
        echo ""
        sed -ie "s/row_size=$prev_size/row_size=$SIZE/g" $EDIT_FILE
        sed -ie "s/col_size=$prev_size/col_size=$SIZE/g" $EDIT_FILE
        sed -ie "s/max_iterations=$prev_pass/max_iterations=$PASS/g" $EDIT_FILE
        sed -ie "s/repetitions=$prev_pass/repetitions=$PASS/g" $EDIT_FILE

        prev_size=$SIZE
        prev_pass=$PASS
        count=$((count+1))

        ./$BUILD_FILE

        echo ""
        echo "Generated for $SIZE x $SIZE with $PASS passes"
        echo ""

        cp "./build/mandelbrot.png" "./images/$count.mandelbrot_${SIZE}_${PASS}.png"
        
    done
done
```


![Generated images](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*Wu-I9mjifg7MeS8DIU_Q9g.png)

More iterations means better quality of the image, you can zoom in and see the small details and tiny fractal repetitions, but to see these clearly the resolution must be increased.

# The winning moment

It was Day 2 and we both had absolutely nothing with us.
We sat at the back thinking what we would present the crowd with.
We had about 3 hours in our hands to build something.
While brainstorming, we were randomly playing with the Mandelbrot directory already given by Intel in their Virtual Private Server.
We ran the code with the proper command and was later told to rerun using `qbus -I` which redirected us to another portal maybe through some kind of routing.
We then decided to create a bash script to randomise four values in the original program i.e. `row_size`, `column_size`, `max_iterations` and `repetitions`.
We were able to do this and now we had started generating images in a folder.
Some images with higher resolution or more repetitions took more time than the rest.
The longest time was taken by 16K resolution image with 1000 repetitions which took approximately 50 minutes (probably still wayy less than an average C++ or Python script generating the same iterations and resolution).

We demoed our solution on a presentation made on Keynote.
We remarkably remember that we were the only team with the minimal interaction with Nandy Sir and also the only ones to receive a round of applause from him.
At the end of all prizes, 6 stood out of 13 and were congratulated on stage for the same.
Then came the cash prizes for the Top 3.
As soon as second was done, we thought the claps were consolatory of nature and we were already packing.
But then we realised, we were indeed 1st. (Out of excitement, **I smacked the Krish’s Macbook Pro, like Davie504 would slap bass** 😂).
In the end we received 12K INR as a prize in the form of Amazon Vouchers.