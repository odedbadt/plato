import("./app").then((app_module) => {
    console.log("app loaded");
    const app = new app_module.App('stellated_dodecahedron');
    app.init()
});